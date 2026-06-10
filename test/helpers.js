'use strict';

// window グローバルを Node で解決する
global.window = global;

function loadModule(name) {
  require(`../js/${name}.js`);
}

loadModule('strategy');
loadModule('game');

module.exports = { Strategy: global.Strategy, Game: global.Game };
