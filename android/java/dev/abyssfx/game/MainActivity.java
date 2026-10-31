package dev.abyssfx.game;

import android.app.Activity;
import android.content.ContentValues;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 单页 WebView 壳：把 APK 内的 assets/www 通过 https 虚拟源暴露给页面，
 * 保证 localStorage、Canvas、WebAudio 都按正常 https 源工作，且完全离线。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final String ASSET_ROOT = "www/";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F5F4EE"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebViewClient(new LocalClient());
        web.addJavascriptInterface(new Bridge(), "AbyssNative");
        setContentView(web);
        web.loadUrl(START_URL);
    }

    /** 拦截虚拟域的请求，直接读 APK 内 assets/www */
    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri == null || !HOST.equals(uri.getHost())) return null;
            String path = uri.getPath();
            if (path == null) return notFound();
            if (path.startsWith("/")) path = path.substring(1);
            if (!path.startsWith("assets/")) return notFound();
            String assetPath = ASSET_ROOT + path.substring("assets/".length());
            if (assetPath.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open(assetPath);
                String mime = mimeFor(assetPath);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime, isText(mime) ? "utf-8" : null, 200, "OK", headers, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            // 只允许应用内虚拟域；外部链接一律不打开
            return uri == null || !HOST.equals(uri.getHost());
        }
    }

    private WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream("Not found".getBytes()));
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript")
                || mime.contains("svg") || mime.contains("xml");
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    /** 分享卡导出：网页优先调用这个接口，而不是依赖 <a download> */
    private class Bridge {
        @JavascriptInterface
        public void savePng(String dataUrl, String filename) {
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0) throw new IllegalArgumentException("bad data url");
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                String safeName = filename == null || filename.isEmpty() ? "abyss-fx.png" : filename;
                String path = saveImage(bytes, safeName);
                toast("分享卡已保存：" + path);
            } catch (Exception e) {
                toast("保存分享卡失败：" + e.getMessage());
            }
        }
    }

    private String saveImage(byte[] bytes, String filename) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AbyssFX");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("无法创建媒体条目");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("无法写入媒体");
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContentResolver().update(uri, values, null, null);
            return "相册/AbyssFX/" + filename;
        }
        File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "AbyssFX");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");
        File file = new File(dir, filename);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file.getAbsolutePath();
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    @Override
    public void onBackPressed() {
        // 有弹窗时先触发页面的 Esc 关闭逻辑；没有弹窗再退出
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){var m=document.querySelectorAll('.modal-backdrop:not(.hidden)');" +
                        "if(!m.length) return false;" +
                        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));" +
                        "return true;})()",
                value -> {
                    if (!"true".equals(value)) finish();
                });
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
