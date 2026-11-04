'use strict';

// window グローバルを Node で解決する
global.window = global;

function loadModule(name) {
  require(`../js/${name}.js`);
}

loadModule('strategy-data');
loadModule('strategy');
loadModule('game');
loadModule('analysis');
loadModule('progress');

module.exports = { Strategy: global.Strategy, Game: global.Game, Analysis: global.Analysis, Progress: global.Progress };
