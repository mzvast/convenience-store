import * as THREE from './vendor/three.module.js';
import { CATALOG, money } from './shop.js';

/** Create reusable scene materials, geometry, product artwork and game controls. */
export function createWorld(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f1f2e8');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const camera = new THREE.OrthographicCamera(-10, 10, 8, -8, .1, 100);
  const materialCache = new Map();
  const geometryCache = new Map();
  const productMaps = new Map();
  const productTemplates = new Map();
  const stock = [];
  const obstacles = [];
  const keys = new Set();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const clock = new THREE.Clock();
  const lookTarget = new THREE.Vector3(0, .85, .4);
  const followTarget = new THREE.Vector3();
  let viewAngle = .55;
  let zoom = 1;
  let follow = false;
  let enabled = true;
  let currentState = null;
  let route = [];
  let arrival = null;
  let nearest = null;
  let pointerStart = null;
  let dragged = false;
  let onPick = () => {};
  let onCheckout = () => {};
  let onNear = () => {};
  let onLocation = () => {};
  let lastLocation = '';
  let lastNear = '';
  let elapsed = 0;

  /** Cache plain materials; textured and transparent materials are explicit. */
  function material(color, roughness = .65, metalness = 0) {
    const key = `${color}|${roughness}|${metalness}`;
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return materialCache.get(key);
  }

  /** Create a mesh with coherent shadow defaults. */
  function mesh(geometry, mat, x = 0, y = 0, z = 0, parent = scene) {
    const item = new THREE.Mesh(geometry, mat);
    item.position.set(x, y, z);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }

  /** Reuse dimensions for the store's repeating boxes. */
  function box(w, h, d, color, x, y, z, parent = scene) {
    const key = `box:${w}:${h}:${d}`;
    if (!geometryCache.has(key)) geometryCache.set(key, new THREE.BoxGeometry(w, h, d));
    return mesh(geometryCache.get(key), typeof color === 'string' ? material(color) : color, x, y, z, parent);
  }

  /** Soft bevels give product cartons and fixtures believable edges. */
  function rounded(w, h, d, color, x, y, z, radius = .05, parent = scene) {
    const key = `round:${w}:${h}:${d}:${radius}`;
    if (!geometryCache.has(key)) {
      const shape = new THREE.Shape();
      const a = -w / 2, b = -h / 2, r = Math.min(radius, w / 3, h / 3, d / 3);
      shape.moveTo(a + r, b);
      shape.lineTo(a + w - r, b);
      shape.quadraticCurveTo(a + w, b, a + w, b + r);
      shape.lineTo(a + w, b + h - r);
      shape.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
      shape.lineTo(a + r, b + h);
      shape.quadraticCurveTo(a, b + h, a, b + h - r);
      shape.lineTo(a, b + r);
      shape.quadraticCurveTo(a, b, a + r, b);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: d - r * 2, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: r, bevelThickness: r });
      geometry.translate(0, 0, -d / 2 + r);
      geometryCache.set(key, geometry);
    }
    return mesh(geometryCache.get(key), typeof color === 'string' ? material(color) : color, x, y, z, parent);
  }

  /** Reuse cylindrical geometry for packaging and small shop fixtures. */
  function cylinder(top, bottom, height, color, x, y, z, parent = scene, segments = 24) {
    const key = `cyl:${top}:${bottom}:${height}:${segments}`;
    if (!geometryCache.has(key)) geometryCache.set(key, new THREE.CylinderGeometry(top, bottom, height, segments));
    return mesh(geometryCache.get(key), typeof color === 'string' ? material(color) : color, x, y, z, parent);
  }

  /** Build a color-correct canvas texture without remote artwork dependencies. */
  function texture(width, height, paint) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const context = surface.getContext('2d');
    paint(context, width, height);
    const map = new THREE.CanvasTexture(surface);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return map;
  }

  /** Print sharp labels on an unlit plane, readable even in warm shelf lighting. */
  function label(text, width, height, x, y, z, color = '#345849', background = '#f5eed9', parent = scene, fontSize = 64) {
    const map = texture(768, Math.max(64, Math.round(768 * height / width)), (c, w, h) => {
      c.fillStyle = background;
      c.fillRect(0, 0, w, h);
      c.fillStyle = color;
      c.font = `600 ${fontSize}px "Noto Sans SC", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2, w * .9);
    });
    return mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }), x, y, z, parent);
  }

  /** Draw original print artwork: brand, flavor illustration, seams and nutrition. */
  function packaging(product) {
    if (productMaps.has(product.id)) return productMaps.get(product.id);
    const map = texture(512, 768, (c, w, h) => {
      c.fillStyle = product.color;
      c.fillRect(0, 0, w, h);
      const gradient = c.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#ffffff18'); gradient.addColorStop(.32, '#ffffff00'); gradient.addColorStop(.8, '#0000000d'); gradient.addColorStop(1, '#ffffff25');
      c.fillStyle = gradient; c.fillRect(0, 0, w, h);
      c.fillStyle = product.accent;
      c.fillRect(0, 38, w, 12); c.fillRect(0, h - 90, w, 7);
      c.fillStyle = product.id === 'cola' || product.id === 'tea' || product.id === 'noodles' ? '#fff5dd' : product.accent;
      c.textAlign = 'center';
      c.font = '600 19px sans-serif'; c.fillText('L I T T L E   M A R T', w / 2, 100);
      c.font = `900 ${product.english.length > 10 ? 39 : 64}px Georgia,serif`;
      const words = product.english.split(' ');
      if (words.length > 1) {
        c.fillText(words[0], w / 2, 194, 465);
        c.fillText(words.slice(1).join(' '), w / 2, 253, 465);
      } else c.fillText(product.english, w / 2, 215, 465);
      c.font = '500 27px sans-serif'; c.fillText(product.name, w / 2, 310);
      c.save(); c.translate(256, 465);
      if (product.id === 'orange') {
        c.fillStyle = '#c46a1e'; c.beginPath(); c.arc(0, 0, 108, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff0b5'; c.beginPath(); c.arc(0, 0, 100, 0, Math.PI * 2); c.fill();
        for (let i = 0; i < 9; i++) { c.save(); c.rotate(i * Math.PI * 2 / 9); c.fillStyle = '#f5ae32'; c.beginPath(); c.moveTo(6, 3); c.arc(0, 0, 88, .08, .6); c.closePath(); c.fill(); c.restore(); }
        c.fillStyle = '#43804a'; c.beginPath(); c.ellipse(65, -95, 42, 17, -.6, 0, Math.PI * 2); c.fill();
      } else if (['chips', 'cookies', 'matcha'].includes(product.id)) {
        for (let i = 0; i < 5; i++) {
          c.save(); c.translate((i % 3 - 1) * 61, Math.floor(i / 3) * 60 - 45); c.rotate(i * .52);
          c.fillStyle = product.id === 'matcha' ? '#b9bd75' : '#b67b31'; c.beginPath(); c.ellipse(0, 0, 63, product.id === 'chips' ? 45 : 57, 0, 0, Math.PI * 2); c.fill();
          c.fillStyle = product.id === 'matcha' ? '#d8d69c' : '#edc979'; c.beginPath(); c.ellipse(-3, -4, 56, product.id === 'chips' ? 38 : 50, 0, 0, Math.PI * 2); c.fill();
          c.strokeStyle = '#b9854733'; c.lineWidth = 3;
          for (let j = -3; j < 4; j++) { c.beginPath(); c.moveTo(j * 12, -25); c.lineTo(j * 12 + 5, 25); c.stroke(); }
          if (product.id === 'cookies') { c.fillStyle = '#794d2a'; for (let j = 0; j < 8; j++) { c.beginPath(); c.arc(Math.cos(j * 2.4) * j * 5, Math.sin(j * 2.4) * j * 5, 4, 0, 7); c.fill(); } }
          c.restore();
        }
      } else if (['tea', 'water'].includes(product.id)) {
        c.strokeStyle = product.accent; c.lineWidth = 4;
        c.beginPath(); c.moveTo(-150, 60); c.lineTo(-50, -60); c.lineTo(0, 0); c.lineTo(60, -105); c.lineTo(150, 60); c.stroke();
        c.beginPath(); c.moveTo(-140, 76); c.quadraticCurveTo(-10, 25, 150, 76); c.stroke();
        if (product.id === 'tea') for (let i = 0; i < 5; i++) { c.fillStyle = '#49744e'; c.beginPath(); c.ellipse(-65 + i * 30, 110 - i * 15, 27, 10, -.6, 0, 7); c.fill(); }
      } else if (product.id === 'strawberry' || product.id === 'candy') {
        for (let i = 0; i < 3; i++) { c.save(); c.translate((i - 1) * 72, i === 1 ? -15 : 35); c.rotate((i - 1) * .35); c.fillStyle = ['#b94a4a', '#d7b24e', '#66854f'][product.id === 'candy' ? i : 0]; c.beginPath(); c.moveTo(-38, -35); c.bezierCurveTo(-75, 25, 0, 88, 8, 77); c.bezierCurveTo(90, -30, 36, -62, -38, -35); c.fill(); c.fillStyle = '#4b7b47'; c.beginPath(); c.ellipse(0, -37, 31, 12, -.3, 0, 7); c.fill(); c.fillStyle = '#f8d6a7'; for(let j=0;j<9;j++){c.beginPath();c.ellipse(Math.sin(j*2.4)*25,Math.cos(j*2.4)*29+7,2,4,0,0,7);c.fill();} c.restore(); }
      } else if (product.id === 'noodles') {
        c.fillStyle = '#f7deb0'; c.beginPath(); c.ellipse(0, 20, 120, 70, 0, 0, 7); c.fill();
        c.strokeStyle = '#cc9b4e'; c.lineWidth = 8;
        for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(-85, -15 + i * 8); c.bezierCurveTo(-30, -70 + i * 8, 25, 60 + i * 4, 90, -15 + i * 8); c.stroke(); }
        c.fillStyle = '#7b9852'; c.fillRect(-30, 4, 12, 16); c.fillRect(50, -8, 10, 15);
      } else if (product.id === 'coffee') {
        c.fillStyle = '#f1e3bb'; c.beginPath(); c.arc(0, 0, 99, 0, 7); c.fill();
        c.strokeStyle = '#765941'; c.lineWidth = 5;
        for(let i=-1;i<2;i++){c.save();c.translate(i*52,i===0?-20:30);c.rotate(i*.4);c.fillStyle='#74543b';c.beginPath();c.ellipse(0,0,29,45,.4,0,7);c.fill();c.strokeStyle='#d6b07c';c.beginPath();c.moveTo(5,-31);c.bezierCurveTo(-20,-12,20,12,-5,31);c.stroke();c.restore();}
      } else if (product.id === 'milk') {
        c.fillStyle = '#f9fbf2'; c.beginPath(); c.arc(0, 0, 105, 0, 7); c.fill();
        c.fillStyle = '#49719a'; c.beginPath(); c.moveTo(0,-75); c.bezierCurveTo(-160,60,10,145,65,42); c.bezierCurveTo(85,5,30,-45,0,-75); c.fill();
        c.fillStyle = '#ffffff'; c.font = 'bold 35px sans-serif'; c.fillText('100%',0,45);
      } else {
        c.font = 'italic 86px Georgia'; c.fillStyle = '#fff2d5'; c.fillText('Original', 0, 20, 450);
        for(let i=0;i<7;i++){c.strokeStyle='#fff2d566';c.lineWidth=3;c.beginPath();c.arc(-130+i*44,80+Math.sin(i)*12,5+i%3*4,0,7);c.stroke();}
      }
      c.restore();
      c.fillStyle = product.accent; c.font = 'bold 24px sans-serif'; c.fillText(product.size, 256, 645);
      c.font = '12px sans-serif'; c.fillText('A LITTLE GOODNESS IN EVERY DAY', 256, 679);
      c.fillStyle = product.accent;
      for (let i = 0; i < 35; i++) c.fillRect(150 + i * 6, 707, i % 3 ? 2 : 4, 27);
      c.fillStyle = '#ffffff30';
      for(let i=0;i<8;i++)c.fillRect(10+i*3,5,1,20);
    });
    productMaps.set(product.id, map);
    return map;
  }

  /** Build a detailed physical package; clones share geometry and print textures. */
  function makeProduct(product) {
    if (productTemplates.has(product.id)) return productTemplates.get(product.id).clone(true);
    const group = new THREE.Group();
    const paper = new THREE.MeshStandardMaterial({ map: packaging(product), roughness: product.shape === 'bag' ? .42 : .58, metalness: product.shape === 'can' ? .26 : 0 });
    const aluminum = material('#d6d8cb', .27, .78);
    if (product.shape === 'bottle') {
      const points = [[.0,-.32],[.13,-.32],[.155,-.29],[.158,-.2],[.153,.16],[.15,.25],[.1,.31],[.066,.38],[.066,.45],[0,.45]].map(([x,y])=>new THREE.Vector2(x,y));
      mesh(new THREE.LatheGeometry(points, 24), material(product.color, .25, .05), 0, 0, 0, group);
      const wrap = mesh(new THREE.CylinderGeometry(.158, .158, .42, 32, 1, true), paper, 0, -.025, 0, group);
      wrap.rotation.y = -Math.PI / 2;
      cylinder(.075, .075, .075, material(product.accent,.38), 0, .47, 0, group);
      cylinder(.082, .082, .015, product.accent, 0, .425, 0, group);
      for(let i=0;i<3;i++)cylinder(.159,.159,.012,material(product.color,.25),0,-.24+i*.026,0,group);
      cylinder(.055,.055,.008,'#f1e9c8',0,.513,0,group);
    } else if (product.shape === 'can') {
      const body = cylinder(.153, .153, .5, paper, 0, 0, 0, group, 32);
      body.rotation.y = -Math.PI / 2;
      cylinder(.146,.153,.045,aluminum,0,.267,0,group);
      cylinder(.153,.14,.03,aluminum,0,-.262,0,group);
      const rim = mesh(new THREE.TorusGeometry(.142,.008,6,32),aluminum,0,.292,0,group);rim.rotation.x=Math.PI/2;
      cylinder(.132,.132,.006,material('#b4b7a8',.35,.6),0,.292,0,group);
      const tab=mesh(new THREE.TorusGeometry(.031,.009,6,12),aluminum,0,.3,.02,group);tab.rotation.x=Math.PI/2;tab.scale.y=1.5;
    } else if (product.shape === 'carton') {
      box(.34,.57,.27,product.color,0,-.025,0,group);
      const face = mesh(new THREE.PlaneGeometry(.342,.57),paper,0,-.025,.137,group);
      const back = face.clone();back.position.z=-.137;back.rotation.y=Math.PI;group.add(back);
      const roof=new THREE.BufferGeometry();
      roof.setAttribute('position',new THREE.Float32BufferAttribute([-.17,.26,.135,.17,.26,.135,.17,.38,0,-.17,.26,.135,.17,.38,0,-.17,.38,0,-.17,.26,-.135,.17,.38,0,.17,.26,-.135,-.17,.26,-.135,-.17,.38,0,.17,.38,0],3));roof.computeVertexNormals();
      mesh(roof,material(product.color),0,0,0,group);
      box(.34,.03,.025,product.accent,0,.39,0,group);
      cylinder(.036,.036,.022,material('#f6f2df',.45),.07,.314,.075,group).rotation.x=.85;
    } else if (product.shape === 'bag') {
      const geometry = new THREE.BoxGeometry(.4,.6,.15,10,12,4);
      const positions=geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
        const fullness=Math.sin((y+.3)/.6*Math.PI);
        positions.setXYZ(i,x*(.86+.14*fullness),y,z*(.55+fullness*.9)+Math.sin(x*65+y*45)*.009);
      }
      geometry.computeVertexNormals();
      mesh(geometry,paper,0,0,0,group);
      for(const y of [-.305,.305]){
        box(.36,.025,.075,product.color,0,y,0,group);
        for(let i=0;i<10;i++)box(.005,.025,.08,material(product.accent,.6),-.16+i*.035,y,0,group);
      }
    } else if(product.shape==='cup') {
      const body=cylinder(.23,.16,.45,paper,0,0,0,group,32);body.rotation.y=-Math.PI/2;
      cylinder(.24,.24,.025,material('#eee0ba',.5),0,.24,0,group);
      const lid=mesh(new THREE.CircleGeometry(.224,32),new THREE.MeshStandardMaterial({map:packaging(product),roughness:.6}),0,.255,0,group);lid.rotation.x=-Math.PI/2;
    } else {
      rounded(.43,.64,.18,product.color,0,0,0,.014,group);
      const face=mesh(new THREE.PlaneGeometry(.43,.64),paper,0,0,.101,group);
      const back=face.clone();back.position.z=-.101;back.rotation.y=Math.PI;group.add(back);
      box(.4,.013,.17,product.accent,0,.326,0,group);
    }
    group.traverse(item=>{if(item.isMesh){item.castShadow=false;item.receiveShadow=true;}});
    productTemplates.set(product.id,group);
    return group.clone(true);
  }

  /** Add a stock slot with its own reachable aisle position. */
  function stockItem(product, x, y, z, approachX, approachZ, rotation = 0, scale = 1) {
    const group=makeProduct(product);
    group.position.set(x,y,z);group.rotation.y=rotation;group.scale.setScalar(scale);scene.add(group);
    const entry={
      /** Unique physical unit id, independent of its product kind. */ id:`unit-${stock.length}`,
      /** Catalog id used by cart accounting. */ productId:product.id,
      /** Rendered package root. */ group,
      /** Walkable inspection position next to this shelf. */ approach:new THREE.Vector3(approachX,0,approachZ),
      /** World-space package center for picking feedback. */ center:new THREE.Vector3(x,y,z),
    };
    group.traverse(item=>{if(item.isMesh)item.userData.stockId=entry.id;});
    stock.push(entry);
    return entry;
  }

  /** Register a padded collision rectangle shared by keyboard and route finding. */
  function obstacle(x,z,w,d) { obstacles.push({
    /** Minimum padded world x. */ minX:x-w/2-.28,
    /** Maximum padded world x. */ maxX:x+w/2+.28,
    /** Minimum padded world z. */ minZ:z-d/2-.28,
    /** Maximum padded world z. */ maxZ:z+d/2+.28,
  }); }

  scene.add(new THREE.HemisphereLight('#fffbee','#afbaa0',1.8));
  const sun=new THREE.DirectionalLight('#fff3d7',3.0);
  sun.position.set(-8,15,9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:.5,far:45});
  sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;sun.shadow.radius=4;scene.add(sun);
  const fill=new THREE.DirectionalLight('#d9ece8',1.1);fill.position.set(7,6,-6);scene.add(fill);
  const glowMaterial=new THREE.MeshBasicMaterial({color:'#fff1c9'});
  const teal='#357c71',darkTeal='#23564c',cream='#e8e1ce',trim='#b6bba9',orange='#d98649',wood='#bf986b';

  // Architecture follows the reference image; the roof opens to expose playable aisles.
  const ground=mesh(new THREE.PlaneGeometry(200,200),material('#edf0e3'),0,-.28,0);ground.rotation.x=-Math.PI/2;ground.castShadow=false;
  rounded(13.5,.28,13.0,'#d0d2bd',0,-.12,1.2,.12);
  rounded(12.5,.18,11.2,'#a6b4a3',0,.01,.3,.08);
  const floorMap=texture(512,512,(c,w,h)=>{
    c.fillStyle='#ddd9c4';c.fillRect(0,0,w,h);
    c.strokeStyle='#c1c0aa';c.lineWidth=3;c.strokeRect(0,0,w,h);
    c.fillStyle='#d5d2bd';c.fillRect(3,3,w-6,3);c.fillRect(3,3,3,h-6);
    let seed=31;for(let i=0;i<1700;i++){seed=(seed*16807)%2147483647;c.fillStyle=i%2?'#aca88b15':'#ffffff17';c.fillRect(seed%w,Math.floor(seed/w)%h,1,1);}
  });
  floorMap.wrapS=floorMap.wrapT=THREE.RepeatWrapping;floorMap.repeat.set(13,12);
  const floor=mesh(new THREE.PlaneGeometry(11.6,10.2),new THREE.MeshStandardMaterial({map:floorMap,roughness:.72}),0,.115,.3);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
  // Sidewalk pavers and a doormat place the entrance clearly in the world.
  for(let i=0;i<13;i++)box(.96,.045,1.0,'#d7d6c0',-5.76+i*.96,.065,6.4);
  rounded(2.3,.025,1.1,'#466e5a',0,.13,5.75,.03);
  const welcome=label('HELLO, NEIGHBOR.',1.9,.32,0,.148,5.75,'#dedfc7','#466e5a',scene,70);welcome.rotation.x=-Math.PI/2;
  box(11.8,3.8,.18,cream,0,2,-4.8);
  box(.18,3.8,10.1,cream,-5.8,2,.2);
  box(.18,.75,10.1,cream,5.8,.51,.2);
  for(let i=0;i<8;i++)box(.025,3.65,.026,'#c5c5af',-5.65+i*1.6,1.95,-4.69);
  box(11.6,.24,.23,'#a6b4a2',0,.25,-4.65);
  box(.23,.24,10,'#a6b4a2',-5.65,.25,.2);
  rounded(12.05,.72,.48,teal,0,3.94,5.25,.14);
  box(11.85,.22,.495,'#f5e6cc',0,3.76,5.265);
  box(11.85,.16,.50,orange,0,3.65,5.268);
  rounded(.45,.72,10.6,teal,-5.9,3.94,.2,.1);
  rounded(.45,.72,10.6,teal,5.9,3.94,.2,.1);
  rounded(12.05,.72,.45,teal,0,3.94,-4.95,.1);
  box(11.7,.11,.5,'#e9e7d2',0,4.34,5.25);
  label('L I T T L E  M A R T',4.3,.43,0,4.01,5.51,'#fcf4d9',teal,scene,70);
  label('OPEN 24/7',1.25,.25,4.4,4,5.51,'#e7e9be',teal,scene,80);
  label('m.',.6,.43,-4.5,4,5.51,'#fcf4d9',teal,scene,110);
  for(const x of [-5.72,-1.28,1.28,5.72]){
    rounded(.16,3.27,.18,trim,x,1.98,5.2,.025);
    box(.2,.55,.24,'#aeb5a0',x,.4,5.2);
  }
  box(11.5,.16,.27,trim,0,.25,5.2);
  // A clear central doorway stays open; window glass is intentionally faint.
  const glass=new THREE.MeshPhysicalMaterial({color:'#c9e1d5',transparent:true,opacity:.12,roughness:.08,metalness:.1,depthWrite:false,side:THREE.DoubleSide});
  for(const x of [-3.5,3.5]){
    const pane=box(4.15,2.8,.035,glass,x,1.92,5.2);pane.castShadow=false;
    box(4.2,.12,.26,teal,x,.65,5.22);
    box(4.2,.28,.23,cream,x,.42,5.21);
    box(4.2,.05,.16,trim,x,2.68,5.2);
  }
  const door=new THREE.Group();door.position.set(1.25,.22,5.2);door.rotation.y=-1.12;scene.add(door);
  box(1.16,3.1,.065,glass,-.59,1.55,0,door);
  for(const x of [-1.17,0])box(.055,3.1,.1,trim,x,1.55,0,door);
  for(const y of [.02,3.07])box(1.2,.06,.1,trim,-.59,y,0,door);
  cylinder(.025,.025,.55,material('#777f70',.25,.7),-1.02,1.5,.09,door);
  obstacle(-3.65,5.2,4.1,.08);obstacle(3.65,5.2,4.1,.08);
  obstacle(-5.8,.2,.1,10);obstacle(5.8,.2,.1,10);obstacle(0,-4.8,11.6,.1);
  // Warm task lights under the fascia and above the refrigerated section.
  for(const x of [-4.9,-2.8,2.8,4.9]){
    box(.42,.09,.22,glowMaterial,x,3.42,5.1);
    const lamp=new THREE.PointLight('#ffda94',2.4,5,2);lamp.position.set(x,3.05,4.3);scene.add(lamp);
  }
  label('DAILY GOODS  /  日 常 好 物',4.6,.32,-2.5,3.35,-4.68,darkTeal,cream,scene,54);
  label('CHILLED & FRESH',2.6,.32,3.6,3.35,-4.68,darkTeal,cream,scene,66);
  // Low rear roof equipment keeps the reference's small futuristic details.
  box(11.6,.13,1.1,'#c5c8b5',0,4.27,-4.45);
  rounded(1.5,.6,.74,'#c9ccbd',3.7,4.61,-4.45,.08);
  for(let i=0;i<7;i++)box(1.0,.035,.03,'#7d887a',3.7,4.4+i*.065,-4.06);
  const solar=box(2.25,.05,.8,material('#354f69',.35,.45),-.2,4.45,-4.4);solar.rotation.x=.22;
  for(let i=0;i<7;i++)box(.014,.015,.78,'#9caeae',-1.2+i*.34,4.49,-4.4);
  cylinder(.035,.035,1.1,material('#818c78',.3,.6),-3.9,4.72,-4.45);
  cylinder(.04,.04,.3,glowMaterial,-3.9,5.22,-4.45);
  const dish=mesh(new THREE.SphereGeometry(.46,28,16,0,Math.PI*2,0,.85),material('#ccd0c1',.3,.4),-4.75,4.7,-4.4);dish.rotation.x=-.65;dish.rotation.z=-.4;
  cylinder(.08,.16,.35,'#85917e',-4.75,4.45,-4.4);

  /** Build a stocked shelf whose front faces the entrance. */
  function shelf(x,z,width,rows,back=false) {
    const depth=back?.58:.78;
    const height=back?2.65:1.94;
    const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
    rounded(width,.22,depth,'#b1b6a1',0,.24,0,.025,group);
    box(width-.08,height,.055,'#d9d5bd',0,height/2+.3,-depth/2+.04,group);
    for(const side of [-1,1]){
      box(.07,height+.13,depth,cream,side*(width/2-.025),height/2+.22,0,group);
      box(.035,height,.055,'#9ca38e',side*(width/2-.025),height/2+.3,depth/2,group);
    }
    obstacle(x,z,width,depth);
    const columns=Math.floor((width-.18)/.43);
    for(let row=0;row<rows;row++){
      const y=.38+row*(back?.63:.56);
      box(width,.065,depth,cream,0,y,0,group);
      box(width,.07,.055,wood,0,y-.005,depth/2,group);
      if(back)box(width-.08,.025,.08,glowMaterial,0,y+.56,-.17,group);
      for(let col=0;col<columns;col++){
        const index=back?(row*3+Math.floor(col/2))%CATALOG.length:((z>0?4:0)+row+Math.floor(col/2))%CATALOG.length;
        const product=CATALOG[index];
        const px=x-width/2+.26+col*(width-.45)/Math.max(1,columns-1);
        const scale=back?.76:.72;
        stockItem(product,px,y+.065+(product.shape==='bottle'?.32:product.shape==='carton'?.26:.25)*scale,z+.06,px,z+depth/2+.65,0,scale);
        if(col%2===0){
          label(`¥${money(product.price)}`,.3,.09,px,y-.004,z+depth/2+.031,'#594f36','#f4eedb',scene,100);
          if(back)stockItem(product,px,y+.065+.25*scale,z-.18,px,z+depth/2+.65,.1,scale);
        }
      }
    }
    return group;
  }
  shelf(-2.48,-4.26,5.7,4,true);
  shelf(-1.95,-1.45,3.7,3);
  shelf(-1.95,1.4,3.7,3);
  label('SNACKS  /  零食',1.28,.19,-1.95,2.15,1.82,darkTeal,cream,scene,65);
  label('DRINKS  /  饮品',1.32,.19,-1.95,2.15,-1.03,darkTeal,cream,scene,65);
  // Chilled drinks have glass doors, handles, vents and cool interior lighting.
  for(let bay=0;bay<3;bay++){
    const x=1.15+bay*1.36;
    // Hollow cabinets keep the stocked interior visible through the glass.
    box(1.33,2.95,.08,'#aab7ab',x,1.64,-4.53);
    for(const side of [-1,1])box(.09,2.95,.8,'#aab7ab',x+side*.62,1.64,-4.16);
    for(const y of [.2,3.08])box(1.33,.09,.8,'#aab7ab',x,y,-4.16);
    box(.05,2.5,.03,glowMaterial,x-.53,1.7,-3.72);
    for(let row=0;row<4;row++){
      const y=.48+row*.58;
      box(1.15,.035,.61,'#b4bdb1',x,y,-4.03);
      for(let col=0;col<3;col++){
        const p=CATALOG[[0,1,7,3,10,2][(bay*2+row)%6]];
        stockItem(p,x-.36+col*.36,y+.24,-3.89,x,-2.8,0,.65);
      }
      label('FRESH DAILY',.7,.06,x,y-.02,-3.699,'#738473','#e9eddc',scene,45);
    }
    const pane=box(1.19,2.53,.025,glass,x,1.66,-3.68);pane.castShadow=false;
    for(const dx of [-.62,.62])box(.045,2.58,.06,'#7f9387',x+dx,1.66,-3.65);
    for(const y of [.36,2.96])box(1.27,.045,.06,'#7f9387',x,y,-3.65);
    cylinder(.018,.018,.52,material('#697d71',.3,.7),x+.45,1.5,-3.59);
    for(let i=0;i<5;i++)box(.85,.018,.02,'#6d8174',x,.235+i*.037,-3.73);
    obstacle(x,-4.06,1.32,.8);
  }
  // A compact coffee corner adds recognizable equipment and countertop stock.
  rounded(.95,1.05,2.2,teal,-4.95,.66,-.2,.04);
  box(1.04,.12,2.28,'#ddd8be',-4.95,1.24,-.2);
  rounded(.65,.8,.6,'#707b69',-4.9,1.7,-.65,.04);
  box(.42,.15,.03,material('#243c30',.3),-4.9,1.91,-.335);
  label('COFFEE',.35,.1,-4.9,1.92,-.313,'#e7ddb4','#243c30',scene,80);
  box(.42,.19,.3,'#3e4d40',-4.9,1.4,-.26);
  cylinder(.075,.055,.17,'#efe4ca',-4.9,1.43,-.2);
  cylinder(.18,.18,.07,'#c2c2a8',-4.9,2.135,-.65);
  cylinder(.16,.16,.27,material('#594735',.3),-4.9,2.3,-.65);
  for(let i=0;i<3;i++)cylinder(.075,.065,.22,'#f1e6c9',-5.05+i*.16,1.42,.5);
  obstacle(-4.95,-.2,.95,2.2);

  // Checkout desk is reachable from the central aisle and front entrance.
  rounded(2.35,1.03,1.15,teal,3.75,.67,2.95,.07);
  box(2.45,.12,1.24,'#d8c9a9',3.75,1.24,2.95);
  box(2.2,.14,.035,orange,3.75,.86,3.55);
  label('CHECKOUT  /  收银台',1.7,.25,3.75,.66,3.538,'#f2ecd2',teal,scene,62);
  obstacle(3.75,2.95,2.35,1.15);
  box(.5,.045,.42,'#4c5e50',3.25,1.33,3.0);
  const screen=rounded(.53,.36,.07,'#344e42',3.25,1.57,3.04,.03);screen.rotation.x=-.25;
  label('HELLO :)',.43,.22,3.25,1.57,3.09,'#bad799','#344e42',scene,88).rotation.x=-.25;
  cylinder(.04,.04,.23,'#7e8c77',3.25,1.4,2.98);
  box(.36,.05,.3,'#657960',4.22,1.34,3.21);
  box(.24,.008,.12,new THREE.MeshBasicMaterial({color:'#93c39c'}),4.22,1.37,3.21);
  label('小麦 · 为你服务',.9,.19,4.65,1.54,3.12,darkTeal,'#ede1be',scene,72);
  cylinder(.018,.018,.24,'#8c9a7d',4.65,1.4,3.1);
  const checkoutRing=mesh(new THREE.RingGeometry(.43,.46,48),new THREE.MeshBasicMaterial({color:'#beab70',transparent:true,opacity:.68,side:THREE.DoubleSide}),3.6,.14,4.17);checkoutRing.rotation.x=-Math.PI/2;

  /** Create the friendly cashier with an emissive face and articulated arms. */
  function buildRobot() {
    const group=new THREE.Group();group.position.set(3.9,.14,1.98);scene.add(group);
    cylinder(.35,.42,.12,material('#748d73',.35,.25),0,.08,0,group);
    cylinder(.12,.14,.56,'#b8bda2',0,.4,0,group);
    rounded(.57,.65,.4,'#dbb675',0,.94,0,.09,group);
    rounded(.76,.58,.48,'#e4c792',0,1.64,0,.11,group);
    rounded(.63,.38,.05,material('#263f34',.3),0,1.66,.263,.08,group);
    const eyeMat=new THREE.MeshBasicMaterial({color:'#c5e6a4'});
    for(const x of [-.16,.16])rounded(.065,.1,.02,eyeMat,x,1.68,.297,.025,group);
    const smile=mesh(new THREE.TorusGeometry(.085,.008,6,20,Math.PI),eyeMat,0,1.6,.298,group);smile.rotation.z=Math.PI;
    cylinder(.018,.018,.18,'#9b9f7c',0,2,0,group);
    mesh(new THREE.SphereGeometry(.045,12,8),new THREE.MeshBasicMaterial({color:'#e0924c'}),0,2.1,0,group);
    for(const x of [-.43,.43]){
      mesh(new THREE.SphereGeometry(.105,12,8),material('#84957a',.35,.3),x,1.13,0,group);
      const arm=rounded(.13,.4,.16,'#ddc28d',x,1.04,.08,.05,group);arm.rotation.x=-.4;
      mesh(new THREE.SphereGeometry(.08,12,8),material('#84957a',.35,.3),x,.87,.17,group);
    }
    label('m.',.24,.16,0,.98,.217,teal,'#dbb675',group,100);
    return group;
  }
  const robot=buildRobot();

  /** Add a small planted pot with individual curved leaves. */
  function plant(x,z,scale=1) {
    const group=new THREE.Group();group.position.set(x,.14,z);group.scale.setScalar(scale);scene.add(group);
    cylinder(.28,.2,.44,'#b37c57',0,.22,0,group);
    cylinder(.3,.29,.07,'#ce9769',0,.43,0,group);
    cylinder(.255,.255,.025,'#5c5440',0,.46,0,group);
    for(let i=0;i<9;i++){
      const angle=i*2.399,dist=.1+i%3*.07;
      const leaf=mesh(new THREE.SphereGeometry(1,8,6),material(i%2?'#708b52':'#426f4c'),Math.sin(angle)*dist,.66+i%3*.15,Math.cos(angle)*dist,group);
      leaf.scale.set(.09,.3,.055);leaf.rotation.z=Math.sin(angle)*.6;leaf.rotation.x=Math.cos(angle)*.6;
    }
  }
  plant(-5.5,5.9,1.2);plant(5.45,5.9,1.4);plant(5.15,-1.6,.9);
  obstacle(-5.5,5.9,.6,.6);obstacle(5.45,5.9,.65,.65);obstacle(5.15,-1.6,.6,.6);
  const chalk=rounded(.87,1.2,.08,'#395b47',-3.9,.86,6.55,.025);chalk.rotation.y=.15;
  label('TODAY IS A GOOD DAY',.72,.62,-3.9,.95,6.608,'#e5e4c5','#395b47',scene,54).rotation.y=.15;
  for(const x of [-4.27,-3.53]){const leg=box(.055,.95,.055,wood,x,.51,6.49);leg.rotation.x=.2;}
  obstacle(-3.9,6.55,.85,.3);
  for(const x of [-1.65,1.65]){cylinder(.07,.09,.61,'#a2ae95',x,.42,6.68);cylinder(.075,.075,.05,orange,x,.59,6.68);}

  /** Build a third-person shopper with independent swinging limbs and hand prop. */
  function buildPlayer() {
    const group=new THREE.Group();group.position.set(.05,.14,6.6);scene.add(group);
    const body=new THREE.Group();group.add(body);
    rounded(.45,.54,.3,'#e9e1c6',0,.92,0,.1,body);
    const pants=material('#3c6350');
    const legs=[];
    for(const x of [-.12,.12]){
      const pivot=new THREE.Group();pivot.position.set(x,.68,0);body.add(pivot);
      rounded(.16,.43,.19,pants,0,-.19,0,.05,pivot);
      rounded(.18,.13,.29,'#e8e5d3',0,-.44,.04,.04,pivot);legs.push(pivot);
    }
    const arms=[];
    for(const x of [-.29,.29]){
      const pivot=new THREE.Group();pivot.position.set(x,1.1,0);body.add(pivot);
      rounded(.17,.23,.22,'#e9e1c6',0,-.08,0,.06,pivot);
      rounded(.12,.25,.14,'#d2a67f',0,-.27,.015,.04,pivot);arms.push(pivot);
    }
    cylinder(.08,.08,.13,'#d2a67f',0,1.22,0,body);
    mesh(new THREE.SphereGeometry(.225,20,16),material('#d9b18a'),0,1.46,0,body).scale.set(.86,1,.85);
    mesh(new THREE.SphereGeometry(.227,20,12,0,Math.PI*2,0,Math.PI*.53),material('#4c3c2e'),0,1.48,-.02,body);
    mesh(new THREE.SphereGeometry(.24,20,12,0,Math.PI*2,0,Math.PI*.48),material('#8c9d6d'),0,1.56,0,body);
    rounded(.34,.035,.25,'#7e925d',0,1.57,.17,.025,body);
    for(const x of [-.07,.07])mesh(new THREE.SphereGeometry(.016,8,6),material('#3d3c2b'),x,1.47,.174,body);
    const strap=box(.075,.65,.025,'#8b7751',-.055,.95,.169,body);strap.rotation.z=-.6;
    rounded(.24,.28,.1,'#bb9665',.14,.76,.2,.04,body);
    const hand=new THREE.Group();hand.position.set(.02,-.36,.19);arms[1].add(hand);
    return {
      /** Shopper root, used for collision and movement. */ group,
      /** Bobbing visual body. */ body,
      /** Leg pivots animated while walking. */ legs,
      /** Arm pivots animated while walking or holding a package. */ arms,
      /** Attachment point for the held physical package. */ hand,
    };
  }
  const player=buildPlayer();
  // A small wire trolley makes the cart visible beside the third-person shopper.
  const trolley=new THREE.Group();trolley.position.set(-.61,0,-.4);player.group.add(trolley);trolley.visible=false;
  const wire=material('#8c9f88',.35,.55);
  box(.48,.045,.55,teal,0,.48,0,trolley);
  for(const x of [-.25,.25])for(const z of [-.285,.285]){
    cylinder(.016,.016,.33,wire,x,.66,z,trolley);
    cylinder(.016,.016,.36,wire,x,.28,z,trolley);
    const wheel=cylinder(.066,.066,.04,material('#56624e',.7),x,.08,z,trolley,12);wheel.rotation.z=Math.PI/2;
  }
  for(const y of [.5,.64,.8]){
    for(const z of [-.285,.285])box(.52,.018,.018,wire,0,y,z,trolley);
    for(const x of [-.25,.25])box(.018,.018,.59,wire,x,y,0,trolley);
  }
  for(let i=0;i<5;i++)for(const x of [-.25,.25])box(.014,.31,.014,wire,x,.65,-.24+i*.12,trolley);
  for(const x of [-.2,.2])cylinder(.016,.016,.42,wire,x,.79,-.34,trolley);
  box(.44,.045,.065,orange,0,1.01,-.34,trolley);
  const basketContents=new THREE.Group();trolley.add(basketContents);
  const marker=mesh(new THREE.RingGeometry(.21,.24,32),new THREE.MeshBasicMaterial({color:'#e1ad68',transparent:true,opacity:0,side:THREE.DoubleSide}),0,.14,0);marker.rotation.x=-Math.PI/2;
  const focus=mesh(new THREE.TorusGeometry(.22,.012,6,36),new THREE.MeshBasicMaterial({color:'#e5b45f',transparent:true,opacity:.9}),0,0,0);focus.visible=false;
  let heldProp=null;

  /** Check the same padded layout for keyboard motion and automatic walking. */
  function canWalk(x,z) {
    if(x < -5.5 || x > 5.5 || z < -4.45 || z > 7.05)return false;
    return !obstacles.some(o=>x>o.minX&&x<o.maxX&&z>o.minZ&&z<o.maxZ);
  }

  /** Use a small aisle grid; eight-neighbor A* prevents walking through shelves. */
  function findPath(destination) {
    const step=.36,minX=-5.4,minZ=-4.32;
    const toCell=(x,z)=>[Math.round((x-minX)/step),Math.round((z-minZ)/step)];
    const toPoint=(x,z)=>new THREE.Vector3(minX+x*step,.14,minZ+z*step);
    const start=toCell(player.group.position.x,player.group.position.z);
    let end=toCell(destination.x,destination.z);
    const point=toPoint(...end);
    if(!canWalk(point.x,point.z)){
      let best=null,bestDistance=Infinity;
      for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){
        const p=toPoint(end[0]+dx,end[1]+dz),distance=p.distanceToSquared(destination);
        if(canWalk(p.x,p.z)&&distance<bestDistance){best=[end[0]+dx,end[1]+dz];bestDistance=distance;}
      }
      if(!best)return [];end=best;
    }
    const key=(x,z)=>`${x},${z}`;
    const startKey=key(...start),endKey=key(...end);
    const open=[startKey],came=new Map(),cost=new Map([[startKey,0]]),score=new Map([[startKey,0]]);
    let count=0;
    while(open.length&&count++<2000){
      open.sort((a,b)=>score.get(a)-score.get(b));
      const current=open.shift();
      if(current===endKey){
        const points=[];let cursor=current;
        while(cursor!==startKey){points.push(toPoint(...cursor.split(',').map(Number)));cursor=came.get(cursor);}
        return points.reverse();
      }
      const [cx,cz]=current.split(',').map(Number);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const nx=cx+dx,nz=cz+dz,p=toPoint(nx,nz);
        if(!canWalk(p.x,p.z))continue;
        if(dx&&dz){const a=toPoint(cx+dx,cz),b=toPoint(cx,cz+dz);if(!canWalk(a.x,a.z)||!canWalk(b.x,b.z))continue;}
        const nk=key(nx,nz),nextCost=cost.get(current)+Math.hypot(dx,dz);
        if(nextCost>=(cost.get(nk)??Infinity))continue;
        came.set(nk,current);cost.set(nk,nextCost);score.set(nk,nextCost+Math.hypot(end[0]-nx,end[1]-nz));
        if(!open.includes(nk))open.push(nk);
      }
    }
    return [];
  }

  /** Walk to a reachable point, then perform a single optional interaction. */
  function walkTo(point,callback=null) {
    if(!enabled||currentState?.held)return false;
    const path=findPath(point);
    if(!path.length){if(player.group.position.distanceTo(point)<.65){callback?.();return true;}return false;}
    route=path;arrival=callback;
    marker.position.set(path.at(-1).x,.145,path.at(-1).z);marker.material.opacity=.8;
    return true;
  }

  /** Approach a selected product's aisle before allowing pickup. */
  function selectProduct(id) {
    const entry=stock.find(item=>item.id===id);
    if(!entry||!entry.group.visible||!enabled||currentState?.held)return;
    focus.position.copy(entry.center);focus.visible=true;
    walkTo(entry.approach,()=>{if(entry.group.visible)onPick(id);focus.visible=false;});
  }

  /** Resize the renderer and retain a useful overview on narrow screens. */
  function resize() {
    const width=canvas.clientWidth,height=canvas.clientHeight,aspect=width/height;
    renderer.setSize(width,height,false);
    const half=aspect<.85?11.7:10.1;
    camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('pointerdown',event=>{
    canvas.focus({preventScroll:true});
    pointerStart={
      /** Initial pointer x in screen pixels. */ x:event.clientX,
      /** Initial pointer y in screen pixels. */ y:event.clientY,
      /** Right-button orbit gesture flag. */ orbit:event.button===2,
      /** Camera angle at gesture start. */ angle:viewAngle,
    };dragged=false;canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pointerStart)return;
    const dx=event.clientX-pointerStart.x;
    if(Math.abs(dx)+Math.abs(event.clientY-pointerStart.y)>6)dragged=true;
    if(pointerStart.orbit)viewAngle=pointerStart.angle-dx*.006;
  });
  canvas.addEventListener('pointerup',event=>{
    const wasOrbit=pointerStart?.orbit;pointerStart=null;
    if(dragged||wasOrbit||!enabled||currentState?.held)return;
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    // Respect opaque shelf occlusion while letting the ray pass through windows.
    const hits=raycaster.intersectObjects(scene.children,true).filter(hit=>{
      const object=hit.object;
      if(!object.isMesh||object===focus||object===marker||object===checkoutRing)return false;
      if(object.material.transparent&&object.material.opacity<.3)return false;
      let parent=object;while(parent){if(!parent.visible)return false;parent=parent.parent;}return true;
    });
    if(hits[0]?.object.userData.stockId){selectProduct(hits[0].object.userData.stockId);return;}
    const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.14),point=new THREE.Vector3();
    if(raycaster.ray.intersectPlane(plane,point)&&canWalk(point.x,point.z))walkTo(point);
  });
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=THREE.MathUtils.clamp(zoom-event.deltaY*.00065,.75,1.65);},{passive:false});
  window.addEventListener('keydown',event=>{
    if(document.querySelector('dialog[open]')||/INPUT|TEXTAREA/.test(event.target.tagName))return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key))event.preventDefault();
    keys.add(event.key.toLowerCase());
    if(event.key.toLowerCase()==='e'&&nearest&&!event.repeat&&enabled&&!currentState?.held)onPick(nearest.id);
  });
  window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur',()=>{keys.clear();pointerStart=null;});

  /** Move with collision sliding, rather than allowing a diagonal shelf clip. */
  function move(dx,dz) {
    const p=player.group.position;
    if(canWalk(p.x+dx,p.z))p.x+=dx;
    if(canWalk(p.x,p.z+dz))p.z+=dz;
    if(Math.abs(dx)+Math.abs(dz)>.0001){
      const angle=Math.atan2(dx,dz),diff=THREE.MathUtils.euclideanModulo(angle-player.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;
      player.group.rotation.y+=diff*.22;
    }
  }

  /** Animate the shopper, cashier, interaction hints and camera each frame. */
  function frame() {
    const dt=Math.min(clock.getDelta(),.05);elapsed+=dt;
    let moving=false;
    if(enabled&&!currentState?.held){
      let x=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);
      let z=(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0);
      if(x||z){
        route=[];arrival=null;focus.visible=false;
        const length=Math.hypot(x,z);x/=length;z/=length;
        move((x*Math.cos(viewAngle)+z*Math.sin(viewAngle))*dt*2.65,(-x*Math.sin(viewAngle)+z*Math.cos(viewAngle))*dt*2.65);moving=true;
      }else if(route.length){
        const delta=route[0].clone().sub(player.group.position);delta.y=0;
        if(delta.length()<.085){route.shift();if(!route.length){const cb=arrival;arrival=null;cb?.();}}
        else{const speed=Math.min(dt*2.8,delta.length());delta.normalize();move(delta.x*speed,delta.z*speed);moving=true;}
      }
    }
    const swing=moving?Math.sin(elapsed*11)*.48:0;
    player.legs[0].rotation.x=THREE.MathUtils.lerp(player.legs[0].rotation.x,swing,.25);
    player.legs[1].rotation.x=THREE.MathUtils.lerp(player.legs[1].rotation.x,-swing,.25);
    player.arms[0].rotation.x=THREE.MathUtils.lerp(player.arms[0].rotation.x,-swing*.7,.2);
    player.arms[1].rotation.x=THREE.MathUtils.lerp(player.arms[1].rotation.x,currentState?.held?-1.15:swing*.7,.2);
    player.body.position.y=moving?Math.abs(Math.sin(elapsed*11))*.035:Math.sin(elapsed*2)*.006;
    robot.rotation.y=Math.sin(elapsed*.65)*.08;
    if(currentState?.checkingOut)robot.rotation.z=Math.sin(elapsed*8)*.025;
    focus.rotation.y+=dt;focus.scale.setScalar(1+Math.sin(elapsed*4)*.08);
    marker.material.opacity=Math.max(0,marker.material.opacity-dt*.18);
    checkoutRing.material.opacity=.38+Math.sin(elapsed*2)*.16;
    if(currentState){
      const p=player.group.position;
      nearest=null;let closest=1.05;
      for(const item of stock){
        if(!item.group.visible)continue;
        const distance=Math.hypot(p.x-item.approach.x,p.z-item.approach.z);
        if(distance<closest){nearest=item;closest=distance;}
      }
      const nearId=nearest?.id??'';
      if(nearId!==lastNear){lastNear=nearId;onNear(nearest?CATALOG.find(p=>p.id===nearest.productId):null);}
      const location=p.z>5.05?'小店门前':p.x>2.2&&p.z>1.1?'机器人收银台':p.z< -2.4?'冷藏与日常好物':p.x< -3.9?'咖啡角':'零食与饮品区';
      if(location!==lastLocation){lastLocation=location;onLocation(location);}
      if(enabled&&!currentState.held&&currentState.quantity>0&&Math.hypot(p.x-3.6,p.z-4.17)<.85){route=[];arrival=null;onCheckout();}
    }
    const narrow=canvas.clientWidth/canvas.clientHeight<.85;
    followTarget.set(follow?player.group.position.x*.7:0,follow ? .9 : narrow ? 3.9 : 2.0,follow?player.group.position.z*.6:.4);
    lookTarget.lerp(followTarget,dt*2.5);
    camera.zoom=THREE.MathUtils.lerp(camera.zoom,zoom*(follow?1.4:1),dt*5);camera.updateProjectionMatrix();
    camera.position.set(lookTarget.x+Math.sin(viewAngle)*23,lookTarget.y+17,lookTarget.z+Math.cos(viewAngle)*23);
    camera.lookAt(lookTarget);renderer.render(scene,camera);
  }
  renderer.setAnimationLoop(frame);

  return {
    /** Physical stock list consumed by the shopping state model. */ stock,
    /** Subscribe UI actions without coupling the 3D renderer to DOM state. */
    setCallbacks(callbacks){onPick=callbacks.onPick;onCheckout=callbacks.onCheckout;onNear=callbacks.onNear;onLocation=callbacks.onLocation;},
    /** Reconcile reserved stock and attach the selected package to the shopper. */
    sync(state){
      currentState=state;
      for(const item of stock)item.group.visible=state.available.has(item.id);
      trolley.visible=state.quantity>0;
      basketContents.clear();
      state.lines.slice(0,3).forEach((line,index)=>{
        const packageGroup=makeProduct(line.product);packageGroup.scale.setScalar(.31);
        packageGroup.position.set((index-1)*.12,.62,(index%2-.5)*.16);packageGroup.rotation.z=(index-1)*.2;basketContents.add(packageGroup);
      });
      if(heldProp){player.hand.remove(heldProp);heldProp=null;}
      if(state.held){heldProp=makeProduct(state.held);heldProp.scale.setScalar(.5);heldProp.rotation.x=Math.PI/2;player.hand.add(heldProp);}
    },
    /** Walk through navigable aisles to the cashier's automatic checkout zone. */
    goCheckout(){return walkTo(new THREE.Vector3(3.6,.14,4.17));},
    /** Toggle close third-person follow and the wider dollhouse view. */
    toggleView(){follow=!follow;return follow;},
    /** Pause movement while inspecting dialogs or scanning a purchase. */
    setEnabled(value){enabled=value;if(!value){keys.clear();route=[];arrival=null;}},
    /** Mirror virtual direction buttons into the normal movement controls. */
    setKey(key,pressed){if(pressed)keys.add(key.toLowerCase());else keys.delete(key.toLowerCase());},
    /** Export original artwork for compact shopping-cart thumbnails. */
    thumbnail(product){return packaging(product).image.toDataURL('image/png');},
    /** Build a rotating close-up with the exact shelf product geometry. */
    createPreview(previewCanvas){
      const previewRenderer=new THREE.WebGLRenderer({canvas:previewCanvas,alpha:true,antialias:true});
      previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));previewRenderer.setSize(160,180,false);
      previewRenderer.outputColorSpace=THREE.SRGBColorSpace;previewRenderer.toneMapping=THREE.ACESFilmicToneMapping;
      const previewScene=new THREE.Scene();previewScene.add(new THREE.HemisphereLight('#fff9ed','#90a28a',1.8));
      const light=new THREE.DirectionalLight('#fff6de',2);light.position.set(-2,4,5);previewScene.add(light);
      const previewCamera=new THREE.PerspectiveCamera(31,160/180,.1,20);previewCamera.position.set(0,.25,1.85);previewCamera.lookAt(0,.03,0);
      let packageGroup=null;
      previewRenderer.setAnimationLoop(()=>{if(!packageGroup)return;packageGroup.rotation.y=Math.sin(performance.now()*.0006)*.65;previewRenderer.render(previewScene,previewCamera);});
      return {
        /** Replace the inspected object while sharing already-loaded resources. */
        show(product){if(packageGroup)previewScene.remove(packageGroup);packageGroup=product?makeProduct(product):null;if(packageGroup)previewScene.add(packageGroup);else previewRenderer.clear();},
      };
    },
  };
}
