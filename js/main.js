/* 启动入口 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  function boot() {
    const game = new FX.Game();
    window.FX.game = game;
    const ui = new FX.UI(game);
    window.FX.ui = ui;
    game.init();
    ui.init();
    // 任意一次用户手势后初始化音频上下文
    const unlock = () => {
      if (FX.Audio) FX.Audio._ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
