//go:build windows

// 深渊汇率 Windows 桌面壳：内嵌静态站点，用 WebView2 打开。
package main

import (
	"embed"
	"encoding/base64"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed index.html css js assets
var assets embed.FS

const appName = "AbyssFX"

func main() {
	base := filepath.Join(os.Getenv("LOCALAPPDATA"), appName)
	if os.Getenv("LOCALAPPDATA") == "" {
		base = filepath.Join(os.Getenv("APPDATA"), appName)
	}
	if err := os.MkdirAll(base, 0o755); err != nil {
		messageBox("深渊汇率", "无法创建数据目录："+err.Error())
		return
	}

	root, err := fs.Sub(assets, ".")
	if err != nil {
		messageBox("深渊汇率", "读取内置资源失败："+err.Error())
		return
	}
	ln, port, err := listenLocal()
	if err != nil {
		messageBox("深渊汇率", "无法启动内置服务："+err.Error())
		return
	}
	srv := &http.Server{Handler: noCache(http.FileServer(http.FS(root)))}
	go func() { _ = srv.Serve(ln) }()

	winW, winH := initialWindowSize()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		DataPath:  filepath.Join(base, "WebView2"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "深渊汇率 ABYSS FX",
			Width:  uint(winW),
			Height: uint(winH),
			Center: true,
			IconId: 1,
		},
	})
	if w == nil {
		messageBox("深渊汇率", "未能启动 WebView2。\n\n请先安装 Microsoft Edge WebView2 Runtime：\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703")
		return
	}
	defer w.Destroy()

	w.SetSize(960, 640, webview2.HintMin)
	_ = w.Bind("_savePng", savePng)
	_ = w.Bind("_saveText", saveText)
	w.Init(`(function(){
  window.AbyssNative = {
    savePng: function(dataUrl, filename) {
      window._savePng(dataUrl, filename).then(function(p) {
        try { FX.ui.toast('分享卡已保存：' + p, 'ok'); } catch (e) {}
      }).catch(function(e) {
        try { FX.ui.toast('保存分享卡失败：' + e, 'warn'); } catch (_) {}
      });
    },
    saveText: function(text, filename) {
      window._saveText(text, filename).then(function(p) {
        try { FX.ui.toast('存档已保存：' + p, 'ok'); } catch (e) {}
      }).catch(function(e) {
        try { FX.ui.toast('保存存档失败：' + e, 'warn'); } catch (_) {}
      });
    }
  };
})();`)
	w.Navigate(fmt.Sprintf("http://127.0.0.1:%d/index.html", port))
	w.Run()
}

// initialWindowSize 取屏幕可用尺寸的九成，避免小屏上窗口超出桌面。
func initialWindowSize() (int, int) {
	sw, _, _ := getSystemMetrics.Call(0) // SM_CXSCREEN
	sh, _, _ := getSystemMetrics.Call(1) // SM_CYSCREEN
	w, h := int(sw)*9/10, int(sh)*9/10
	if w > 1280 || w <= 0 {
		w = 1280
	}
	if h > 820 || h <= 0 {
		h = 820
	}
	if w < 960 {
		w = 960
	}
	if h < 640 {
		h = 640
	}
	return w, h
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(rw, r)
	})
}

func listenLocal() (net.Listener, int, error) {
	var lastErr error
	for p := 47821; p <= 47840; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			return ln, p, nil
		}
		lastErr = err
	}
	return nil, 0, lastErr
}

// savePng 接收网页分享卡的 data URL，写到 图片/AbyssFX。
func savePng(dataURL, filename string) (string, error) {
	i := strings.Index(dataURL, ",")
	if i < 0 {
		return "", fmt.Errorf("无效的图片数据")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[i+1:])
	if err != nil {
		return "", err
	}
	name := filepath.Base(strings.TrimSpace(filename))
	if name == "" || name == "." || name == `\` || name == "/" {
		name = "abyss-fx.png"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".png") {
		name += ".png"
	}
	dir := filepath.Join(picturesDir(), "AbyssFX")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func picturesDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return os.TempDir()
	}
	return filepath.Join(home, "Pictures")
}

// saveText 接收网页导出的存档 JSON，写到 下载/AbyssFX。
func saveText(text, filename string) (string, error) {
	name := filepath.Base(strings.TrimSpace(filename))
	if name == "" || name == "." || name == `\` || name == "/" {
		name = "abyss-fx-save.json"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".json") {
		name += ".json"
	}
	dir := filepath.Join(downloadsDir(), "AbyssFX")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func downloadsDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return os.TempDir()
	}
	return filepath.Join(home, "Downloads")
}

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	messageBoxW      = user32.NewProc("MessageBoxW")
	getSystemMetrics = user32.NewProc("GetSystemMetrics")
)

func messageBox(title, text string) {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	_, _, _ = messageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}
