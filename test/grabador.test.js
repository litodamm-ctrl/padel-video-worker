const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearGrabador } = require('../src/grabador.js');

test('error y close no crean dos grabadores; el vigilante respeta el reintento', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'grabador-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  let count = 0, child, timer;
  const g = crearGrabador({id:'test',carpeta:dir,rtsp:'test',log:{info(){},warn(){},error(){}},
    spawnProcess(){count++; child = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}; return child;},
    schedule(fn){assert.equal(timer, undefined); timer=fn; return 1;},cancel(){timer=undefined;}
  });
  g.iniciar(); g.iniciar(); assert.equal(count,1);
  child.emit('error',new Error('failed')); child.emit('close',1);
  g.reiniciar('watchdog'); assert.equal(count,1);
  const fn=timer; timer=undefined; fn(); assert.equal(count,2);
  child.emit('close',1); g.detener(); assert.equal(timer,undefined);
});
