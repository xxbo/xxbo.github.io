(async function() {
  'use strict';
  try {
    await Promise.all([RailDataReady, RailRoutingReady]);
  } catch (error) {
    const loading = document.getElementById('game-loading');
    loading.replaceChildren();
    const title = document.createElement('b'), detail = document.createElement('span'), retry = document.createElement('button');
    title.textContent = '模拟核心加载失败'; detail.textContent = error.message;
    retry.textContent = '重新加载'; retry.addEventListener('click', () => location.reload());
    loading.append(title, detail, retry);
    return;
  }
  const UI_VERSION = '46';
  'use strict';
  const DETAIL = RailMapDetail;
  let lodLevel = null,
    viewCache = null,
    stationElements = [],
    facilityElements = [],
    hubElements = [],
    cityElements = [],
    symbolScale = NaN,
    lastLabelPaint = 0,
    cameraFrame = 0,
    trainElementLayer = null,
    trainElements = new Map(),
    drawnTrainMarkers = 0;
  const PERF = RailPerformance;
  let interfacePrefs = PERF.settings();
  const simulationClock = PERF.createClock();
  let lastDots = 0,
    lastPerf = 0,
    computeMs = 0,
    paintMs = 0;
  document.addEventListener('rail-interface-settings', e => {
    interfacePrefs = PERF.settings(e.detail);
    applyCamera();
    renderDots();
    updateQueueLabels();
  });
  const saveQueue = RailSaveQueue.create(),
    memoryAudit = RailMemoryAudit.create();
  const DB = RailSaveStore,
    LS = RailLocalSave;
  let runtimeFault = '',
    storageReadBlocked = false,
    legacySaveText = null,
    saveStatus = '尚未保存',
    saveMeta = null,
    lastSaveError = 0;
  let insertIndex = null,
    pendingImport = null,
    importError = '',
    importResume = false,
    importing = false;
  const INS = RailInsights;
  let achievementFilter = "全部",
    insightPointer = false;
  document.addEventListener("pointerdown", e => {
    if (e.target.closest("#activity-panel")) insightPointer = true;
  }, true);
  window.addEventListener("pointerup", () => insightPointer = false);
  window.addEventListener("pointercancel", () => insightPointer = false);
  const REVIEW = RailOperationsReview,
    OC = RailOperationsCenter,
    D = RailDensity,
    U = RailUrban;
  let centerFilter = 'all',
    centerQuery = '',
    centerReview = null,
    centerAnalysis = null,
    centerReturn = false;
  const F = RailFleet,
    A = RailAlerts;
  const BAL = RailBalance,
    B = RailRegions;
  let region = 'tokyo';
  try {
    const selectedMap = new URLSearchParams(location.search).get('map');
    region = ['tokyo', 'gba'].includes(selectedMap) ? selectedMap : localStorage.getItem(
      'guanchao-rail-last-map') === 'gba' ? 'gba' : 'tokyo';
  } catch {}
  const cfg = B.get(region),
    HubList = RailHubs.forRegion(region);
  StreetMap.setRegion(region);
  const R = RailSim,
    O = RailPassengers,
    N = RailNetwork,
    G = StreetMap,
    C = RailCity,
    M = RailManagement,
    V = RailView,
    X = RailServicePlan,
    Q = RailRidership,
    $ = id => document.getElementById(id),
    KEY_TOKYO = cfg.saveKey;
  const esc = v => String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
  const num = n => Math.round(n).toLocaleString('zh-CN'),
    cash = n => n >= 10000 ? (n / 10000).toFixed(1) : Math.round(n).toLocaleString('zh-CN'),
    clock = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.floor(m) % 60)
    .padStart(2, '0');
  const money = RailCurrency.format;
  const DOM = RailUIDom;
  const viewFormat = {
    num,
    money,
    clock,
    esc
  };
  const lineView = RailLineView.create({
    ...viewFormat,
    F,
    X,
    Q,
    V,
    currency: RailCurrency
  });
  const centerView = RailCenterView.create({
    ...viewFormat,
    Q,
    X,
    F,
    OC,
    fmtHeadway
  });
  const financeView = RailFinanceView.create({
    ...viewFormat,
    M
  });
  const stationsView = RailStationsView.create({
    ...viewFormat,
    Q
  });
  const saveView = RailSaveView.create({
    ...viewFormat,
    B
  });

  const reviewView = RailReviewView.create({
    REVIEW,
    Q,
    currency: RailCurrency,
    clock,
    money,
    num,
    esc
  });
  let resumeAfterEdit = false,
    lastForecastRefresh = 0,
    draftSpec = '6B',
    depotSpec = '6B',
    depotQty = 2,
    alarms = [],
    dispatchDirty = false,
    facilityKind = 'school',
    urbanJob = false,
    urbanDrawRevision = -1,
    densityField = null,
    densityFieldRevision = -1,
    lastDensityPaint = 0,
    densityPaintTimer = null;
  const RECORD_KEY = cfg.recordsKey;
  let personalRecords = {};
  try {
    const raw = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}');
    for (const k of Q.RECORD_FIELDS)
      if (Number.isFinite(raw[k]) && raw[k] >= 0) personalRecords[k] = raw[k];
  } catch {}
  let unlocked = new Set(Q.awards(personalRecords).filter(a => a.unlocked).map(a => a.id));

  function syncRecords() {
    personalRecords = Q.mergeRecords(Q.mergeRecords(personalRecords, s.ridership?.records), INS.records(
      s));
    const added = [];
    for (const a of Q.awards(personalRecords))
      if (a.unlocked && !unlocked.has(a.id)) {
        unlocked.add(a.id);
        added.push(a.name);
      } if (added.length) toast('达成成就 · ' + added[0] + (added.length > 1 ? ' 等 ' + added.length + ' 项' :
      ''));
  }

  function persistRecords() {
    try {
      const other = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}') || {},
        safe = {};
      for (const k of Q.RECORD_FIELDS)
        if (Number.isFinite(other[k]) && other[k] >= 0) safe[k] = other[k];
      personalRecords = Q.mergeRecords(personalRecords, safe);
      localStorage.setItem(RECORD_KEY, JSON.stringify(personalRecords));
    } catch {}
  }

  let stationMenu = false,
    stationQuery = '',
    stationSort = 'waiting',
    account = false,
    inspection = null,
    density = 'off',
    savedRuntime = null,
    lastSave = 0,
    pauseBeforeDialog = false,
    utilityPanel = null,
    stationLine = null,
    hoverPoint = null,
    placementPulse = null;
  let KEY = KEY_TOKYO,
    s = N.emptyWorld(region),
    overview = false,
    sort = 'default',
    selected = null,
    mode = null,
    draft = [],
    undoState = null,
    deleteConfirm = false,
    playing = true,
    speed = 6,
    zoom = window.matchMedia('(max-width:650px)').matches ? 12 : 8,
    camera = {
      x: 1240,
      y: 940
    },
    drag = null,
    lastFrame = 0,
    lastHUD = 0,
    toastTimer, storageOK = true,
    focusTimer, cameraTween = null;
  try {
    const stored = await DB.read(KEY);
    if (stored?.source === 'legacy') legacySaveText = stored.text;
    if (stored?.error) {
      storageReadBlocked = true;
      storageOK = false;
      saveStatus = '数据库读取受阻，保留旧存档';
    }
    if (stored?.source === 'indexeddb') {
      saveMeta = stored;
      saveStatus = '已从本地数据库恢复';
    }
    const raw = stored?.text || (region === 'tokyo' ? (localStorage.getItem('guanchao-rail-game-v6') ||
      localStorage.getItem('guanchao-rail-map-v4')) : null);
    if (raw) {
      const v = JSON.parse(raw),
        state = [6, 7].includes(v.gameVersion) ? v.state : v;
      if (N.validate(state) && state.region === region) {
        s = v.gameVersion === 7 ? state : N.removePreset(state);
        if (v.gameVersion === 7) {
          personalRecords = Q.mergeRecords(personalRecords, LS.records(v.personalRecords));
          if (typeof v.playing === 'boolean') playing = v.playing;
          if ([1, 3, 6, 12, 24].includes(v.speed)) speed = v.speed;
          if (v.signature === M.signature(s)) savedRuntime = v.runtime;
        }
      } else {
        storageOK = false;
        storageReadBlocked = true;
        saveStatus = '存档校验失败，已禁止自动覆盖';
      }
    }
  } catch {
    storageOK = false;
    storageReadBlocked = true;
    saveStatus = '本地数据库读取失败，已禁止自动覆盖';
  }
  unlocked = new Set(Q.awards(personalRecords).filter(a => a.unlocked).map(a => a.id));
  N.upgrade(s);
  M.init(s);
  const migratedUrban = !s.urban;
  U.init(s);
  if (!U.validate(s)) {
    delete s.urban;
    U.init(s);
    storageOK = false;
    storageReadBlocked = true;
  }
  if (!M.validate(s)) {
    delete s.economy;
    M.init(s);
    storageOK = false;
    storageReadBlocked = true;
  }
  const migratedFacilities = U.enableAutomatic(s, C.create(region), RailPlaceNames.places(region));
  U.enableDevelopment(s, C.create(region), RailPlaceNames.places(region));
  Q.enableSatisfaction(s);
  let calculating = false,
    networkRevision = 0,
    forecastPending = false,
    forecastDirty = false,
    forecastTimer = null;
  const demandState = {
    status: 'starting',
    error: '',
    updatedAt: null
  };
  const demandClient = RailWorkerClient.create({
    createWorker: () => typeof Worker === 'function' ? new Worker('demand-worker.js?v=56') : null,
    timeout: 45000,
    timeoutMessage: '后台需求计算超过45秒，已回收计算线程；旧需求继续运行。',
    errorMessage: '客流后台计算失败',
    onFault: error => {
      demandState.error = error.message;
    },
    fallbackOnStartFailure: true,
    fallback: ({
      state
    }) => ({
      result: C.evaluate(state)
    })
  });

  function calculate(state) {
    return demandClient.request({
      state: RailDemandSnapshot.capture(state)
    }).then(message => message.result);
  }
  let forecast = await calculate(s).catch(() => C.evaluate(s)),
    traffic = savedRuntime && O.restore(s, forecast, savedRuntime) || O.create(s, forecast, s.economy
      .minute, s.economy.minute === 420);
  demandState.status = 'ready';
  demandState.updatedAt = traffic.minute;
  if (Math.abs(traffic.minute - s.economy.minute) > .01) traffic = O.create(s, forecast, s.economy.minute,
    false);
  if (migratedFacilities || savedRuntime && forecast.connectionModel === 36) O.rebase(traffic, s,
    forecast);
  delete forecast.preparedDefinitions;
  Q.updateSatisfaction(s, traffic);
  REVIEW.init(s, traffic);
  REVIEW.ready(s, traffic.minute);
  let urbanForecastRevision = s.urban.revision;
  let cityCells = C.world(s).cells.map(c => ({
    ...c,
    display: G.display(c),
    displayHeight: G.display({
      x: c.x,
      y: c.y + c.h / 2
    }).y - G.display({
      x: c.x,
      y: c.y - c.h / 2
    }).y
  }));
  const mapBounds = V.coverage(C.create(region).metadata, s.world);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion:reduce)');
  const tilesLayer = new G.Layer($('street-tiles'), $('tile-status'));
  const vectorLayer = new RailVectorMap.Layer($('vector-map'), $('tile-status'), () => {
    basemap = 'gsi';
    $('basemap-select').value = 'gsi';
    render();
    applyCamera();
    toast('矢量地图暂不可用，已切换地理院图片底图。');
  });
  let basemap = cfg.basemap,
    pointers = new Map(),
    pinch = null;
  try {
    const prefs = JSON.parse(localStorage.getItem(region === 'tokyo' ? 'guanchao-rail-map-prefs-v12' :
      'guanchao-rail-gba-map-prefs-v1') || 'null');
    if (prefs) {
      if ((region === 'gba' ? ['esri', 'osm', 'schematic'] : ['esri', 'vector', 'gsi', 'osm',
          'schematic'
        ]).includes(prefs.basemap)) basemap = prefs.basemap;
      for (const k of Object.keys(vectorLayer.groups))
        if (typeof prefs.groups?.[k] === 'boolean') vectorLayer.groups[k] = prefs.groups[k];
    }
  } catch {}
  $('basemap-select').value = basemap;

  function saveMapPrefs() {
    try {
      localStorage.setItem(region === 'tokyo' ? 'guanchao-rail-map-prefs-v12' :
        'guanchao-rail-gba-map-prefs-v1', JSON.stringify({
          basemap,
          groups: vectorLayer.groups
        }));
    } catch {}
  }

  function display(p) {
    return G.display(p);
  }

  function pixelScale() {
    return $('map').getBoundingClientRect().width / viewSpan().w;
  }

  function save() {
    return saveQueue.request(saveNow);
  }
  async function saveNow() {
    await M.whenIdle(traffic);
    if(runtimeFault||M.lastError(traffic))return false;
    if (runtimeFault) {
      saveStatus = '运营异常，已暂停覆盖上次存档';
      return false;
    }
    if (calculating || importing) return false;
    if (storageReadBlocked) {
      saveStatus = '读取受阻，请导入文件恢复或刷新重试';
      return false;
    }
    syncRecords();
    persistRecords();
    try {
      memoryAudit.record('save-start', s, forecast, traffic, saveQueue);
      const payload = {
        gameVersion: 7,
        playing,
        speed,
        personalRecords,
        state: s,
        runtime: await O.snapshotAsync(traffic),
        signature: M.signature(s)
      };
      saveStatus = '正在写入本地数据库…';
      saveMeta = await DB.write(KEY, payload, legacySaveText);
      memoryAudit.record('save-end', s, forecast, traffic, saveQueue);
      legacySaveText = null;
      storageOK = true;
      saveStatus = '已保存到本地数据库';
      if (inspection?.type === 'saves') renderActivity();
      return true;
    } catch (error) {
      storageOK = false;
      saveStatus = '保存失败，当前进度仍在内存';
      if (Date.now() - lastSaveError > 30000) {
        toast('本地数据库保存失败，请先导出存档文件保留当前进度。');
        lastSaveError = Date.now();
      }
      if (inspection?.type === 'saves') renderActivity();
      return false;
    }
  }

  function toast(text, undo = false) {
    $('toast-text').textContent = text;
    $('undo').hidden = !undo;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $('toast').classList.remove('show');
      $('undo').hidden = true;
    }, 5000);
  }

  function current() {
    return s.services.find(l => l.id === selected);
  }

  function renderWorld() {
    const gba = region === 'gba';
    $('world-content').innerHTML =
      `<div class="world-intro">切换地图会自动保存，各地图独立存档。</div><button data-world="tokyo" class="world-card ${!gba?'chosen':''}"><span>01 / TOKYO</span><strong>东京首都圈</strong><small>东京 · 横滨 · 埼玉 · 千叶</small><em>真实地理参考 · 空白城市生长 ${!gba?'· 当前地图':''}</em></button><button data-world="gba" class="world-card ${gba?'chosen':''}"><span>02 / GREATER BAY AREA</span><strong>粤港澳大湾区</strong><small>广佛 · 深莞 · 港深 · 珠澳 · 九市两区</small><em>真实地理与枢纽 · 空白城市生长 ${gba?'· 当前地图':''}</em></button>${gba?`<div class="section-title">前往城市</div><div class="city-focus-grid">${RailGBA.cities.map((c,i)=>`<button data-focus-city="${i}">${c.name}<small>${(c.population/10000).toFixed(1)}万人</small></button>`).join('')}</div><p class="station-note">区域现实人口仅作背景参考；当前游戏从零密度开始，人口、商业和工业随轨道及市政规划生长。跨境通关和行政规则暂未模拟。</p><a href="gba-sources.md" target="_blank" rel="noopener">数据来源与模拟方法 ↗</a>`:''}`;
  }
  if (region === 'gba') {
    for (const option of $('basemap-select').options)
      if (['gsi', 'vector'].includes(option.value)) option.hidden = option.disabled = true;
    $('fit-core').textContent = '湾区';
    $('source-panel').querySelector('.source-content').innerHTML =
      '<p><b>总量基准：2024年九市两区人口统计。</b>城市合计约8751.5万人，采用澳门统计暨普查局大湾区统计表的千人口径。</p><p><b>空间分布为模拟，非实测栅格。</b>约2公里网格，以城区、镇街、产业走廊为高斯核，将每个城市人口总量分配到陆地区域；简化海岸与岛屿遮罩抑制水域密度。城市中心、山区梯度、工业及商业权重都是原型假设，非精确行政边界或逐楼统计。</p><p>底层人口和用地数据用于地理约束；当前游戏人口与岗位随城市建设逐步增长，设施由系统生成。客流仍按目的地、接驳、票价、班次、容量和乘客满意度计算。机场和部分铁路使用2024公开统计；其余枢纽明确标注估算。2024年总量按366天折算。</p><p><a href="https://www.dsec.gov.mo/BayArea/en-US/?report=1" target="_blank" rel="noopener">官方人口基准</a> · <a href="gba-sources.md" target="_blank" rel="noopener">完整来源与假设</a></p>';
    $('layers-panel').querySelector('.map-source').hidden = true;
  }
  $('source-panel').querySelector('.source-content').innerHTML =
    '<p><b>当前人口、就业、商业和工业全部由城市生长模拟产生。</b>初始密度为零，车站与市政服务吸引开发；每6个游戏小时推进一次，密度不会在建设瞬间凭空填满。</p><p>住宅偏好交通、学校、公园与可达就业；商业偏好人流、换乘、枢纽和市场集聚；工业偏好交通与较低中心区压力，并与密集居住、优质生活服务存在冲突。分值、阈值、建设速度均为游戏假设。</p><p>底图是现实地理，东京原始栅格及大湾区简化陆地遮罩仅用于可开发地理参考，不代表当前游戏人口。机场、铁路枢纽保留公开统计口径，实际接驳按城市成熟度、线路与票价模拟。</p><a href="urban-model.md" target="_blank" rel="noopener">完整模型与来源 ↗</a>';
  try {
    localStorage.setItem('guanchao-rail-last-map', region);
  } catch {}

  function world() {
    return s.world || {
      width: 1040,
      height: 740
    };
  }

  function viewSpan() {
    const rect = $('map').getBoundingClientRect(),
      aspect = rect.width / Math.max(1, rect.height);
    return V.constrain(camera, zoom, aspect, mapBounds);
  }

  function mapView() {
    const span = viewSpan(),
      rect = $('map').getBoundingClientRect(),
      px = rect.width / span.w,
      box = {
        x: span.x - span.w / 2,
        y: span.y - span.h / 2,
        w: span.w,
        h: span.h
      },
      scale = G.scale(box, rect.width),
      km = parseFloat(scale.label) * (scale.label.endsWith(' km') ? 1 : .001);
    return {
      span,
      rect,
      px,
      box,
      scale,
      width: rect.width,
      height: rect.height,
      pixelsPerKm: scale.pixels / km
    };
  }

  function applyCamera() {
    if (cameraFrame) return;
    cameraFrame = requestAnimationFrame(() => {
      cameraFrame = 0;
      applyCameraNow();
    });
  }

  function applyCameraNow() {
    const v = mapView();
    viewCache = v;
    zoom = v.span.zoom;
    camera = {
      x: v.span.x,
      y: v.span.y
    };
    $('map').setAttribute('viewBox', `${v.box.x} ${v.box.y} ${v.box.w} ${v.box.h}`);
    $('map').style.setProperty('--unit', 1 / v.px);
    const changed = updateMapDetail(v);
    if (!Number.isFinite(symbolScale) || Math.abs(symbolScale / v.px - 1) > 1e-6) {
      updateSymbols(v.px);
      symbolScale = v.px;
    }
    updateLabels(changed);
    drawDensity();
    renderConstructionPreview();
    tilesLayer.setSource(basemap === 'vector' ? 'schematic' : basemap);
    tilesLayer.update(v.box, v.width);
    vectorLayer.setEnabled(basemap === 'vector');
    vectorLayer.update(v.box, v.width);
    $('scale-bar').style.width = v.scale.pixels + 'px';
    $('scale-text').textContent = v.scale.label;
    renderDots();
  }

  function cacheMapElements() {
    stationElements = [...$('map').querySelectorAll('.station')].map(g => ({
      g,
      id: +g.dataset.node,
      p: display(s.nodes[+g.dataset.node]),
      priority: +g.dataset.priority,
      ring: g.querySelector('.station-ring'),
      hit: g.querySelector('.station-hit'),
      label: g.querySelector('.station-label'),
      hitLabel: g.querySelector('.station-hit-label'),
      queue: g.querySelector('.queue-label'),
      visible: true
    }));
    const facilities = new Map(s.urban.facilities.map(f => [f.id, f])),
      hubs = new Map(HubList.map(h => [h.id, h]));
    facilityElements = [...$('map').querySelectorAll('[data-facility]')].map(g => ({
      g,
      p: display(facilities.get(g.dataset.facility))
    }));
    hubElements = [...$('map').querySelectorAll('[data-hub]')].map(g => ({
      g,
      p: display(hubs.get(g.dataset.hub)),
      label: g.querySelector('.hub-label')
    }));
    cityElements = [...$('map').querySelectorAll('.city-anchor')].map(g => ({
      g,
      p: display(B.project(RailGBA.cities[+g.dataset.cityIndex].centres[0][1], RailGBA.cities[+g
        .dataset.cityIndex].centres[0][0], region))
    }));
    symbolScale = NaN;
    lastLabelPaint = 0;
  }

  function updateMapDetail(v) {
    const previous = lodLevel;
    lodLevel = DETAIL.level(v.pixelsPerKm, interfacePrefs.detail, !!mode, lodLevel);
    $('map').dataset.detail = lodLevel;
    for (const e of hubElements)
      if (e.label) e.label.style.display = lodLevel === 'full' ? '' : 'none';
    const label = DETAIL.LABELS[lodLevel];
    if ($('map-detail-status').textContent !== label) $('map-detail-status').textContent = label;
    const selectedStops = new Set(current()?.stops || []),
      points = stationElements.map(e => ({
        id: e.id,
        x: (e.p.x - v.box.x) * v.px,
        y: (e.p.y - v.box.y) * v.px,
        priority: e.priority,
        selected: selectedStops.has(e.id)
      })).filter(p => DETAIL.inside(p, v, 35)),
      visible = DETAIL.stations(points, lodLevel);
    let visibilityChanged = previous !== lodLevel;
    for (const e of stationElements) {
      const on = visible.has(e.id);
      if (on !== e.visible) {
        e.visible = on;
        e.g.style.display = on ? '' : 'none';
        visibilityChanged = true;
      }
    }
    return visibilityChanged;
  }

  function updateSymbols(px = (viewCache || mapView()).px) {
    for (const e of facilityElements) e.g.setAttribute('transform',
      `translate(${e.p.x} ${e.p.y}) scale(${1/px})`);
    for (const e of cityElements) {
      e.g.setAttribute('transform', `translate(${e.p.x} ${e.p.y}) scale(${1/px})`);
      e.g.style.display = zoom < 48 ? '' : 'none';
    }
    for (const e of hubElements) {
      e.g.setAttribute('transform', `translate(${e.p.x} ${e.p.y}) scale(${1/px})`);
      if (e.label) e.label.style.display = lodLevel === 'full' ? '' : 'none';
    }
    for (const e of stationElements) {
      const n = s.nodes[e.id],
        p = e.p;
      e.ring.setAttribute('r', (+e.g.dataset.radius) / px);
      e.hit.setAttribute('r', 9 / px);
      if (e.hitLabel) {
        e.hitLabel.setAttribute('x', p.x - 9 / px);
        e.hitLabel.setAttribute('y', p.y - 9 / px);
        e.hitLabel.setAttribute('width', (n.name.length * 11 + 24) / px);
        e.hitLabel.setAttribute('height', 32 / px);
      }
      e.label.setAttribute('x', p.x + 9 / px);
      e.label.setAttribute('y', p.y + 16 / px);
      if (e.queue) {
        e.queue.setAttribute('x', p.x + 9 / px);
        e.queue.setAttribute('y', p.y + 29 / px);
      }
    }
    for (const c of $('map').querySelectorAll('[data-screen-radius]')) c.setAttribute('r', +c.dataset
      .screenRadius / px);
    updateDistanceSymbols();
    for (const label of $('map').querySelectorAll('[data-draft-label]')) label.setAttribute('y', +label
      .dataset.y - 12 / px);
  }

  function updateLabels(force = false) {
    const at = performance.now();
    if (!force && at - lastLabelPaint < 80) return;
    lastLabelPaint = at;
    const v = viewCache || mapView(),
      collision = DETAIL.collisionIndex(),
      selectedStops = new Set(current()?.stops || []),
      enabled = $('map-labels').checked;
    for (const e of [...stationElements].sort((a, b) => b.priority - a.priority)) {
      const must = !!mode || selectedStops.has(e.id),
        box = {
          x: (e.p.x - v.box.x) * v.px + 6,
          y: (e.p.y - v.box.y) * v.px + 5,
          w: s.nodes[e.id].name.length * 11 + 8,
          h: 15
        },
        show = e.visible && (enabled || must) && (!collision.hits(box) || !!mode || must && lodLevel ===
          'full');
      e.label.style.display = show ? '' : 'none';
      if (e.hitLabel) e.hitLabel.style.display = show ? '' : 'none';
      if (show) collision.add(box);
      if (e.queue) e.queue.style.display = e.visible && lodLevel === 'full' && interfacePrefs
        .queueLabels ? '' : 'none';
    }
  }

  function zoomAt(next, clientX, clientY, animate = false) {
    clearTimeout(focusTimer);
    const rect = $('map').getBoundingClientRect(),
      aspect = rect.width / Math.max(1, rect.height),
      base = animate && cameraTween ? {
        x: cameraTween.tx,
        y: cameraTween.ty,
        z: cameraTween.tz
      } : {
        ...camera,
        z: zoom
      },
      span = V.constrain(base, base.z, aspect, mapBounds),
      ax = (clientX - rect.left - rect.width / 2) / rect.width,
      ay = (clientY - rect.top - rect.height / 2) / rect.height,
      point = {
        x: span.x + ax * span.w,
        y: span.y + ay * span.h
      },
      target = V.constrain(base, next, aspect, mapBounds),
      center = {
        x: point.x - ax * target.w,
        y: point.y - ay * target.h
      };
    if (animate) flyTo(center.x, center.y, target.zoom, 260);
    else {
      cameraTween = null;
      camera = center;
      zoom = target.zoom;
      applyCamera();
    }
  }

  function zoomCenter(factor) {
    const r = $('map').getBoundingClientRect(),
      base = cameraTween?.tz || zoom;
    zoomAt(base * factor, r.left + r.width / 2, r.top + r.height / 2, true);
  }

  function setPlaying(on) {
    if (on && runtimeFault) {
      toast('运营异常，请查看运行诊断；刷新可恢复上次成功存档。');
      on = false;
    }
    if (on && s.economy?.blocked) M.settle(s);
    if (on && s.economy?.blocked) {
      toast('资金不足或贷款到期未偿还，请先在资金面板处理。');
      on = false;
    }
    if (on) {
      undoState = null;
      if ($('undo')) $('undo').hidden = true;
    }
    playing = on;
    lastFrame = 0;
    simulationClock.reset();
    $('play').textContent = on ? 'Ⅱ' : '▶ 开始运营';
    document.body.classList.toggle('simulation-paused', !on);
    $('play').setAttribute('aria-label', on ? '暂停运行' : '开始运行');
    document.querySelector('.clock-dot').style.background = on ? '#4baf93' : '#a0b0bb';
  }
  async function commit(action, message) {
    if (calculating) return false;
    await M.whenIdle(traffic);
    await O.materializeAsync(traffic);
    const paused = !playing,
      before = paused ? R.clone(s) : null,
      beforeTraffic = paused ? R.clone(O.snapshot(traffic)) : null,
      reviewMark = REVIEW.prepare(s, traffic),
      result = M.change(s, action);
    if (result?.error) {
      toast(result.error);
      return false;
    }
    O.reconcile(traffic, s);
    REVIEW.record(s, traffic, reviewMark);
    networkRevision++;
    undoState = paused ? {
      state: before,
      runtime: beforeTraffic,
      forecast
    } : null;
    centerAnalysis = null;
    centerRendered = null;
    deleteConfirm = false;
    scheduleForecast();
    save();
    // Only structural edits redraw map geometry. Dispatch/fare changes update the open drawer.
    if (mode || result.quote?.addedKm || result.quote?.removedKm || result.quote?.addedStations ||
      result.quote?.removedStations || !current()) {
      render();
    } else {
      renderPanel();
      if (overview) renderOverview();
      updateHUD();
    }
    toast(message + (result.quote?.net ? ' · ' + (result.quote.net > 0 ? '投入 ' : '回收 ') + money(Math
      .abs(result.quote.net)) : ''), paused);
    return result || true;
  }

  function scheduleForecast() {
    forecastDirty = true;
    if (forecastTimer) clearTimeout(forecastTimer);
    forecastTimer = setTimeout(refreshUrbanDemand, 120);
  }

  function setPane(id, visible) {
    const el = $(id);
    if (el.dataset.visible === String(visible)) return;
    el.dataset.visible = String(visible);
    el._paneAnimation?.cancel();
    el.inert = !visible;
    el.style.pointerEvents = visible ? '' : 'none';
    el.setAttribute('aria-hidden', String(!visible));
    if (visible) {
      el.hidden = false;
      if (!reducedMotion.matches) el._paneAnimation = el.animate([{
        opacity: 0,
        transform: 'translateX(35px) scale(.985)'
      }, {
        opacity: 1,
        transform: 'none'
      }], {
        duration: 420,
        easing: 'cubic-bezier(.16,1,.3,1)'
      });
    } else if (!el.hidden) {
      if (el.contains(document.activeElement)) $('map').focus({
        preventScroll: true
      });
      if (reducedMotion.matches) el.hidden = true;
      else {
        const animation = el.animate([{
          opacity: 1,
          transform: 'none'
        }, {
          opacity: 0,
          transform: 'translateX(35px)'
        }], {
          duration: 190,
          easing: 'cubic-bezier(.4,0,1,1)'
        });
        el._paneAnimation = animation;
        animation.onfinish = () => {
          if (el.dataset.visible === 'false') el.hidden = true;
        };
      }
    }
  }

  function openUtility(type) {
    if (type === 'world') renderWorld();
    if (utilityPanel) closeUtility();
    if (type === 'newgame') {
      pauseBeforeDialog = playing;
      setPlaying(false);
    }
    utilityPanel = type;
    hoverPoint = null;
    render();
    $(type === 'world' ? 'close-world' : type === 'newgame' ? 'cancel-newgame' : type === 'layers' ?
      'close-layers' : 'close-source').focus({
      preventScroll: true
    });
  }

  function closeUtility() {
    const old = utilityPanel;
    utilityPanel = null;
    if (old === 'newgame') setPlaying(pauseBeforeDialog);
    render();
    $(old === 'world' ? 'world-toggle' : old === 'newgame' ? 'new-game' : old === 'layers' ?
      'layers-toggle' : 'density-info')?.focus({
      preventScroll: true
    });
  }

  function render() {
    document.body.classList.toggle('density-mode', density !== 'off');
    refreshUrbanMap();
    document.querySelector('.identity small').textContent = cfg.name + ' · 运营与建设';
    document.body.classList.toggle('esri-basemap', basemap === 'esri');
    document.body.classList.toggle('street-mode', basemap !== 'schematic');
    document.body.classList.toggle('schematic-mode', basemap === 'schematic');
    $('map-attribution').hidden = basemap === 'schematic';
    $('map-attribution').innerHTML = basemap === 'esri' ?
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://www.arcgis.com/home/item.html?id=3a9d3b9701b74ce1b38db86b1116b594" target="_blank" rel="noopener">Esri · HERE · Garmin · USGS · OSM</a>' :
      basemap === 'vector' ?
      '<a href="https://github.com/gsi-cyberjapan/optimal_bvmap" target="_blank" rel="noopener">国土地理院 · 最適化ベクトルタイル</a>' :
      basemap === 'osm' ?
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>' :
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 · 地理院タイル</a>';
    if (!current()) {
      selected = null;
      dispatchDirty = false;
    }
    const pane = utilityPanel === 'world' ? 'world-panel' : utilityPanel === 'layers' ? 'layers-panel' :
      utilityPanel === 'source' ? 'source-panel' : utilityPanel === 'newgame' ? 'newgame-panel' : mode ?
      'edit-bar' : selected ? 'line-panel' : overview ? 'overview-panel' : account ? 'account-panel' :
      stationMenu ? 'stations-panel' : inspection ? 'activity-panel' : null;
    if (pane !== 'overview-panel') releaseCenterWorker();
    document.body.classList.toggle('operations-center', pane === 'overview-panel');
    document.body.classList.toggle('inspecting', !!pane);
    document.body.classList.toggle('drawer-open', !!pane);
    document.body.classList.toggle('editing', !!mode);
    for (const id of ['line-panel', 'overview-panel', 'account-panel', 'stations-panel', 'activity-panel',
        'source-panel', 'newgame-panel', 'layers-panel', 'world-panel', 'edit-bar'
      ]) setPane(id, id === pane);
    $('account-toggle').classList.toggle('active', account && !utilityPanel);
    $('stations-toggle').classList.toggle('active', stationMenu && !utilityPanel);
    $('overview-toggle').classList.toggle('active', overview);
    $('delete-line').disabled = !selected || !!mode;
    $('legend').innerHTML = s.services.map(l =>
      `<button data-line="${l.id}" style="--color:${l.color}" class="${selected===l.id?'active':''}"><i></i>${esc(l.name)}</button>`
    ).join('');
    renderLayers();
    renderPanel();
    renderOverview();
    renderAccount();
    renderStations();
    renderActivity();
    renderMap();
    renderEditBar();
    updateHUD();
    document.dispatchEvent(new CustomEvent('rail-ui-context', {
      detail: {
        pane,
        inspection: inspection?.type || null,
        line: selected,
        mode
      }
    }));
  }

  function refreshUrbanMap() {
    if (s.urban.revision === urbanDrawRevision) return;
    cityCells = C.world(s).cells.map(c => ({
      ...c,
      display: G.display(c),
      displayHeight: G.display({
        x: c.x,
        y: c.y + c.h / 2
      }).y - G.display({
        x: c.x,
        y: c.y - c.h / 2
      }).y
    }));
    urbanDrawRevision = s.urban.revision;
  }
  async function refreshUrbanDemand() {
    if (forecastPending) {
      forecastDirty = true;
      return;
    }
    forecastTimer = null;
    forecastDirty = false;
    forecastPending = true;
    urbanJob = true;
    memoryAudit.record('demand-start', s, forecast, traffic, saveQueue);
    const identity = traffic,
      revision = networkRevision,
      urbanRevision = s.urban.revision;
    demandState.status = 'updating';
    $('calculation-status').hidden = false;
    $('calculation-status').textContent = '需求后台更新中' + (playing ? ' · 运营继续' : '');
    try {
      const next = await calculate(s);
      await M.whenIdle(traffic);
      if (calculating || identity !== traffic || revision !== networkRevision) {
        forecastDirty = true;
        return;
      }
      await O.materializeAsync(traffic);
      O.rebase(traffic, s, next);
      delete next.preparedDefinitions;
      REVIEW.ready(s, traffic.minute);
      demandState.status = 'ready';
      demandState.error = '';
      demandState.updatedAt = traffic.minute;
      forecast = next;
      memoryAudit.record('demand-end', s, forecast, traffic, saveQueue);
      urbanForecastRevision = urbanRevision;
      centerAnalysis = null;
      centerRendered = null;
      Q.updateSatisfaction(s, traffic);
      save();
      if (overview && !document.activeElement?.matches('#overview-panel input,#overview-panel select'))
        renderOverview();
      if (current() && !dispatchDirty && !document.activeElement?.matches('input,select,textarea'))
        renderPanel();
      updateHUD();
    } catch (error) {
      demandState.status = 'error';
      demandState.error = error.message;
      console.warn('Demand update', error);
      toast('需求更新失败：' + error.message + ' 可在管理 → 运行诊断查看。');
      if (!forecastTimer) forecastTimer = setTimeout(() => {
        forecastTimer = null;
        scheduleForecast();
      }, 10000);
    } finally {
      forecastPending = false;
      urbanJob = false;
      if (!calculating) $('calculation-status').hidden = true;
      if (forecastDirty) scheduleForecast();
    }
  }

  function urbanGeometry() {
    let html = '';
    const project = inspection?.type === 'development' ? s.urban.development?.projects.find(p => p.id ===
      inspection.id) : null;
    if (project) {
      const p = display(project),
        kind = U.developmentKinds[project.kind];
      html +=
        `<circle class="development-range" cx="${p.x}" cy="${p.y}" r="${project.radius/.045}" fill="${kind.color}18" stroke="${kind.color}" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/><circle cx="${p.x}" cy="${p.y}" data-screen-radius="5" r="${5/pixelScale()}" fill="${kind.color}" pointer-events="none"/>`;
    }
    for (const f of s.urban.facilities) {
      const t = U.TYPES[f.kind],
        p = display(f);
      if (inspection?.type === 'facility' && inspection.id === f.id) html +=
        `<circle class="facility-range" cx="${p.x}" cy="${p.y}" r="${t.radius[f.level-1]/.045}"/>`;
      html +=
        `<g class="facility-marker" data-facility="${f.id}" transform="translate(${p.x} ${p.y})" role="button" tabindex="0" aria-label="${t.name} Lv.${f.level}"><circle r="13" fill="white" stroke="${t.color}" stroke-width="2"/><text text-anchor="middle" y="4" fill="${t.color}">${t.icon}</text><text class="facility-level" x="10" y="-11">${f.level}</text><title>${esc(f.name||t.name)} · Lv.${f.level}</title></g>`;
    }
    return html;
  }

  function destinationRows() {
    return s.urban.facilities.map(f => ({
      f,
      ...U.connection(s, f)
    })).sort((a, b) => b.priority - a.priority || b.demand - a.demand);
  }

  function facilityListContent() {
    const t = C.world(s).totals,
      rows = destinationRows(),
      linked = rows.filter(a => a.connected),
      unserved = rows.filter(a => !a.connected),
      total = rows.reduce((v, a) => v + a.demand, 0),
      coverage = total ? linked.reduce((v, a) => v + a.demand, 0) / total : 0;
    return `<div class="section-title">优先接驳清单<small>综合到访需求与接驳距离排序</small></div><div class="destination-list">${rows.map(a=>{const f=a.f,t=U.TYPES[f.kind];return `<button data-destination="${f.id}" class="destination-card ${a.connected?'connected':''}" style="--facility:${t.color}"><i>${t.icon}</i><span><b>${esc(f.name||t.name)}</b><small>Lv.${f.level} · 潜在到访 ${num(a.demand)} 人次/日</small><small>${a.nearest?'最近站步行 '+a.nearest.walk.toFixed(2)+' km':'附近暂无车站'}</small></span><em>${a.status} ↗</em></button>`;}).join('')}</div><p class="station-note">以800米步行接驳、1.25倍绕行判断；有车站且已计划投放列车才计入覆盖。潜在到访＝设施到访权重＋岗位通勤权重，是规划指标，实际乘车还取决于出发地、票价、运营与满意度，不保证全部转化为客流。</p><details class="map-source"><summary>城市如何自动建设</summary><p>设施为按地区地理与地名生成的游戏目的地，非现实POI实测。初始分布覆盖多个片区，人口增长后系统继续新增并按周边人口升级；市政投资与维护由城市承担。住宅、商业和工业仍随交通及设施服务逐步发展。</p></details>`;
  }
  let urbanTab = 'development';

  function developmentCard(p) {
    const kind = U.developmentKinds[p.kind];
    return `<button class="development-card" data-development="${p.id}" style="--development:${kind.color}"><span class="development-type">${kind.name}<b>${p.label}</b></span><strong>${esc(p.name)}</strong><span class="development-numbers">${num(p.population)} 居民 · ${num(p.jobs)} 岗位</span><span class="development-connection">${p.served?'中心已计划接驳':p.nearest?'最近站步行 '+p.nearest.walk.toFixed(1)+' km':'暂无轨道接驳'}<b>查看 →</b></span>${p.until?`<small>约 ${p.until} 个游戏日后启动</small>`:''}</button>`;
  }

  function urbanContent() {
    const t = C.world(s).totals,
      d = U.developmentSummary(s);
    return `<div class="urban-hero development-hero"><span>城市建设总览</span><strong>${num(t.people)}<small>居民</small></strong><p>${num(t.jobs)} 岗位 · ${s.urban.facilities.length} 处市政目的地</p></div><div class="development-tabs" role="tablist" aria-label="城市建设分类"><button role="tab" tabindex="${urbanTab==='development'?0:-1}" aria-selected="${urbanTab==='development'}" data-urban-tab="development">发展机会</button><button role="tab" tabindex="${urbanTab==='facilities'?0:-1}" aria-selected="${urbanTab==='facilities'}" data-urban-tab="facilities">市政接驳</button></div>${urbanTab==='facilities'?facilityListContent():d?`<div class="section-title">区域开发新增上限<small>全图共享 · 游戏参数</small></div><div class="development-budget"><span>居民<b>+${num(d.daily.r)}</b></span><span>商业岗位<b>+${num(d.daily.c)}</b></span><span>产业岗位<b>+${num(d.daily.i)}</b></span></div>${d.last?`<p class="development-recent">上一建设轮 · 新增 ${num(d.last.added.r)} 居民 / ${num(d.last.added.c+d.last.added.i)} 岗位</p>`:''}<div class="section-title">近期发展机会<small>启动与未接驳片区优先</small></div><div class="development-list">${d.projects.slice(0,6).map(developmentCard).join('')}</div><details class="development-more"><summary>其余 ${Math.max(0,d.projects.length-6)} 个片区</summary><div class="development-list">${d.projects.slice(6).map(developmentCard).join('')}</div></details><details class="map-source"><summary>城市增长规则</summary><p>每6个游戏小时建设一次，新增人口和岗位由全图共享上限分配，未使用额度不囤积。片区分阶段启动，开发方向、市政和轨道条件决定增长位置；有上限不代表一定用满；学校、医院等系统设施的固定岗位另行计入。已有城区保留，新增车站不再各自无限吸引人口。地点借用本地地名，方向、时间和参数均为游戏模拟，不是真实规划公告。</p></details>`:'<p>此存档尚未建立发展机会。</p>'}`;
  }

  function developmentContent(id) {
    const d = U.developmentSummary(s),
      p = d?.projects.find(p => p.id === id);
    if (!p) return '<button id="back-to-urban">返回城市总览</button>';
    const k = U.developmentKinds[p.kind];
    return `<button id="back-to-urban" class="back-to-line">← 城市建设总览</button><div class="urban-hero development-hero"><span>${k.name} · ${p.label}</span><strong>${esc(p.name)}</strong><p>模拟发展片区 · 半径约 ${p.radius.toFixed(1)} km</p></div><div class="stat-grid"><div><span>当前居民</span><strong>${num(p.population)}</strong></div><div><span>当前岗位</span><strong>${num(p.jobs)}</strong></div><div><span>中心轨道接驳</span><strong>${p.served?'已安排服务':'待接驳'}</strong></div><div><span>新增开发阶段</span><strong>${p.until?p.until+' 日后启动':p.label}</strong></div></div><div class="section-title">规划方向</div><p class="development-guidance">${k.reason}</p><p class="development-guidance secondary">${p.nearest?'最近站「'+esc(p.nearest.name)+'」距片区中心步行约 '+p.nearest.walk.toFixed(2)+' km。':'可先定位片区，选择合适的首条线路。'}接驳按中心800米步行及已计划投放判断，不能代表整个片区覆盖。优先连接互补的居住与就业地点，保留后续扩展空间。</p><button class="primary" data-focus-development="${p.id}">在地图定位</button><details class="map-source"><summary>发展范围与建设约束</summary><p>片区影响随距离平滑衰减，边界不是地籍或行政边界；每一轮共享区域人口与岗位增量。建设从启动期逐步进入成熟期，现有人口与岗位保留。这些是模拟机会，不是保证客流、保证收益或真实城市项目。</p></details>`;
  }

  function facilityContent(f) {
    const t = U.TYPES[f.kind],
      a = U.facilityStats(s, f),
      c = U.connection(s, f);
    return `<button id="back-to-urban" class="back-to-line">← 城市规划建设总览</button><div class="urban-hero"><span>系统城市设施 · ${t.name} Lv.${f.level}</span><strong>${esc(f.name||t.name)}</strong><p>${t.effect}</p></div><div class="stat-grid"><div><span>潜在到访 · 人次/日</span><strong>${num(c.demand)}</strong></div><div><span>覆盖居民</span><strong>${num(a.population)}</strong></div><div><span>市政服务半径</span><strong>${a.radius}<small> km</small></strong></div><div><span>轨道接驳</span><strong>${c.status}</strong></div></div><div class="section-title">地铁规划建议</div><p class="station-note">${c.connected?'已可步行接驳，继续改善频率、拥挤和与住宅区的连通性。':c.nearest&&c.nearest.walk<=.8?'附近已有车站，需购车并安排投放，才能形成服务。':'在设施800米步行范围内设站，并连接居民区、就业中心与换乘站。'}${c.nearest?'最近站为「'+esc(s.nodes[c.nearest.id].name)+'」，估计步行 '+c.nearest.walk.toFixed(2)+' km。':''}</p><button data-focus-facility="${f.id}" class="primary">在地图定位</button><p class="station-note">设施由系统自动生成和升级，玩家无需购买、维护或拆除。地点与规模为游戏模拟；潜在到访不是实际客流。</p>`;
  }

  function urbanArea(p) {
    const v = U.zone(s, p),
      valid = U.buildable(s, C.create(region), p);
    return `<div class="section-title">开发倾向<small>${valid?'陆地可开发':'水域或无可靠陆地信息'}</small></div><div class="suitability">${[['residential','住宅','#4e9b83'],['commercial','商业','#d99542'],['industrial','工业','#9578be']].map(([key,name,color])=>`<div><span>${name}</span><i><b style="width:${v[key]*100}%;background:${color}"></b></i><strong>${Math.round(v[key]*100)}</strong></div>`).join('')}</div><p class="station-note">交通 ${Math.round(v.rail*100)} · 市政 ${Math.round(v.amenities*100)} · 枢纽 ${Math.round(v.hub*100)}。40分具备建设条件，59/73/86分提高目标密度；实际增长还受片区阶段与区域新增上限约束。</p>`;
  }

  function renderFacilityBuild() {
    const t = U.TYPES[facilityKind];
    $('map-hint').textContent = '点击地图规划' + t.name + ' · 拖动浏览';
    $('edit-bar').innerHTML =
      `<div class="panel-header"><div class="panel-heading"><h2>规划${t.name}</h2><button id="cancel-facility" class="panel-close" aria-label="取消设施规划">×</button></div></div><div class="panel-scroll"><div class="facility-types">${Object.entries(U.TYPES).map(([kind,x])=>`<button data-plan-kind="${kind}" style="--facility:${x.color}"><b>${x.icon}</b><span>${x.name}<small>${money(x.price[0])}</small><em>${x.effect}</em></span></button>`).join('')}</div><div class="urban-hero"><span>Lv.1 · 半径 ${t.radius[0]} km</span><strong>${money(t.price[0])}</strong><p>${t.effect}</p><p>每日维护 ${money(t.price[0]*.001)} · 点击陆地点位完成建设</p></div><div id="facility-preview"><p class="station-note">移动鼠标查看住宅、商业、工业开发倾向。</p></div></div>`;
  }

  function updateFacilityPreview() {
    const el = $('facility-preview');
    if (el && hoverPoint) htmlIfChanged(el, urbanArea(hoverPoint));
  }

  function fmtHeadway(value) {
    return lineView.fmtHeadway(value);
  }

  function specOptions(value) {
    return lineView.specOptions(value);
  }

  function trainOptions(value) {
    return lineView.trainOptions(value);
  }

  function markDispatchDirty() {
    dispatchDirty = true;
    if ($('dispatch-pending')) $('dispatch-pending').hidden = false;
  }

  function recommendDispatch() {
    markDispatchDirty();
    const l = current();
    if (!l) return;
    const st = N.stats(s, forecast, l.id),
      potential = [...new Set(l.stops)].reduce((v, id) => {
        const c = forecast.catchment.stations[id];
        return v + (c ? (c.people + (c.jobs || 0) * .7) * .15 : 0);
      }, 0),
      r = F.recommend(s, l, Math.max(st.riders, potential));
    $('dispatch-mode').value = 'auto';
    $('dispatch-offpeak').value = r.offPeak;
    $('dispatch-peak').value = r.peak;
    document.querySelectorAll('[data-dispatch-row]').forEach(el => el.hidden = el.dataset.dispatchRow !==
      'auto');
    toast('推荐平峰 ' + r.offPeak + ' 列 / 高峰 ' + r.peak + ' 列' + (r.peak < r.peakNeed ? '，库存不足，理想高峰需 ' + r
      .peakNeed + ' 列' : '') + ' · 点击应用投放生效');
  }

  function depotContent() {
    const stock = s.depot.stock,
      online = traffic.trains.length,
      total = Object.values(stock).reduce((a, b) => a + b, 0);
    return `<div class="depot-hero"><span>自有列车</span><strong>${total}<small>列</small></strong><p>在线 ${online} · 库内 ${Math.max(0,total-online)} · 余额 ${money(s.economy.cash)}</p></div><div class="section-title">购买列车</div><label class="depot-label">车型与编组<select id="depot-spec">${specOptions(depotSpec)}</select></label><div class="config-row"><label for="depot-qty">购买数量</label><input id="depot-qty" type="number" min="1" max="80" step="1" value="${depotQty}"></div><p class="station-note">单列价格 <b id="depot-unit">${money(F.SPECS[depotSpec].price)}</b> · 容量、价格为游戏设定。</p><button id="buy-stock" class="primary">购买并入库</button><div class="section-title">库存与配属</div>${Object.values(F.SPECS).map(v=>{const purchased=stock[v.id],reserved=F.reserved(s,v.id),active=traffic.trains.filter(t=>s.services.find(l=>l.id===(t.parentLine||t.service))?.stockSpec===v.id).length;return `<div class="stock-row"><b>${v.id}</b><span>持有 ${purchased} · 配属 ${reserved}<small>在线 ${active} · 库内 ${Math.max(0,purchased-active)} · 可配属 ${purchased-reserved}</small></span></div>`;}).join('')}<div class="section-title">线路投放</div>${s.services.map(l=>`<button class="depot-line" data-line="${l.id}"><b>${esc(l.name)} · ${l.stockSpec}</b><span>计划 ${F.planned(l,traffic.minute)} / 预留 ${l.fleet} 列 →</span></button>`).join('')||'<p>先建设线路，再选择兼容车型投放。</p>'}<p class="station-note">购车扣除余额；减少投放或删除线路会释放配属，车辆保留在库中。闲置列车承担常规固定费用 15% 的保管费。A、B 型不能混用，跨线交路要求相同车型与编组。</p>`;
  }

  function alarmContent() {
    return `<p class="station-note">站内候车 ≥85% 或出现站外排队时报警；≥95% 为严重。线路最高满载 ≥90% 且有候车，或理论疏散时间 ≥10 分钟时报警。疏散时间按当前双向运力粗估，不是实际等待时间。</p>${alarms.map(a=>`<button class="alarm-card ${a.level}" ${a.type==='station'?`data-alert-station="${a.id}"`:`data-line="${a.id}"`}><span>${a.level==='critical'?'严重':'预警'} · ${a.type==='station'?'车站':'线路'}</span><b>${esc(a.name)}</b><small>${esc(a.message)}</small></button>`).join('')||'<div class="alarm-empty">当前没有客流超载报警</div>'}<p class="station-note">客流恢复后自动解除，不弹窗、不暂停运营。</p>`;
  }

  function updateAlarms() {
    alarms = A.evaluate(s, traffic);
    const b = $('alarms-toggle');
    b.classList.toggle('alarm-active', alarms.length > 0);
    htmlIfChanged(b, '客流报警' + (alarms.length ? ' <span>' + alarms.length + '</span>' : ''));
    const line = $('line-alarm'),
      a = alarms.find(a => a.type === 'line' && a.id === selected);
    if (line) htmlIfChanged(line, a ?
      `<button class="alarm-card ${a.level}" data-open-alarms="1">${esc(a.message)} · 查看报警</button>` :
      '');
    document.querySelectorAll('[data-station-row]').forEach(el => {
      const a = alarms.find(a => a.type === 'station' && a.id === +el.dataset.stationRow);
      el.classList.toggle('station-alarm', !!a);
    });
    const live = $('dispatch-live'),
      l = current();
    if (l && live) live.innerHTML = F.planned(l, traffic.minute) + '<small>列 · ' + (l.dispatch.mode ===
      'auto' ? (F.peak(traffic.minute) ? '高峰' : '平峰') : '手动') + '</small>';
    const h = $('computed-headway');
    if (h && l) {
      const runs = traffic.plan.services.filter(r => r.parentLine === l.id),
        rate = runs.reduce((v, r) => v + 1 / X.headway(traffic.plan, r), 0);
      h.textContent = fmtHeadway(rate ? 1 / rate : Infinity);
    }
  }
  let lineTab = 'overview',
    lineViewId = null;

  function showLineTab(id) {
    lineTab = id;
    for (const el of $('line-panel').querySelectorAll('[data-line-view]')) el.hidden = el.dataset
      .lineView !== lineTab;
    for (const el of $('line-panel').querySelectorAll('[role=tab]')) el.setAttribute('aria-selected',
      String(el.dataset.lineTab === lineTab));
    $('line-panel').querySelector('.panel-scroll').scrollTop = 0;
  }

  function renderPanel() {
    const l = current();
    if (!l) return;
    if (lineViewId !== l.id) {
      lineViewId = l.id;
      lineTab = 'overview';
    }
    dispatchDirty = false;
    const panel = $('line-panel'),
      scroll = panel.dataset.renderedLine === l.id ? panel.querySelector('.panel-scroll')?.scrollTop ||
      0 : 0;
    const connectionOpen = panel.dataset.renderedLine === l.id && !!panel.querySelector(
        '#line-connections')?.open,
      choicesOpen = panel.dataset.renderedLine === l.id && !!panel.querySelector('#line-choices')?.open;
    panel.dataset.renderedLine = l.id;
    const st = N.stats(s, forecast, l.id);
    const salvage = deleteConfirm ? Math.max(0, -(M.preview(s, c => N.removeLine(c, l.id)).net || 0)) : 0;
    panel.innerHTML = lineView.content({
      state: s,
      forecast,
      minute: traffic.minute,
      line: l,
      stats: st,
      tab: lineTab,
      deleteConfirm,
      salvage
    });
    if (connectionOpen && $('line-connections')) $('line-connections').open = true;
    if (choicesOpen && $('line-choices')) $('line-choices').open = true;
    panel.querySelector('.panel-scroll').scrollTop = scroll;
  }

  function renderLayers() {
    if (utilityPanel !== 'layers') return;
    if (region === 'gba') {
      $('layer-controls').innerHTML =
        '<p class="station-note">大湾区使用轻量图片底图，地图左下角可切换 Esri / OSM / 简洁示意。图片底图不支持拆分道路或建筑图层。</p>';
      $('use-vector').hidden = true;
      return;
    }
    $('layer-controls').innerHTML = Object.entries(RailVectorMap.GROUPS).map(([key, label]) =>
      `<label class="map-layer-row"><span>${label}</span><input type="checkbox" data-base-layer="${key}" ${vectorLayer.groups[key]?'checked':''}></label>`
    ).join('');
  }

  function patternCard(l, p, i) {
    return lineView.patternCard(s, l, p, i);
  }

  function stopOptions(l, index) {
    return lineView.stopOptions(s, l, index);
  }

  function readPatterns() {
    return [...document.querySelectorAll('[data-pattern-index]')].map(el => {
      const p = {
        kind: el.dataset.kind
      };
      for (const key of ['from', 'to', 'fleet', 'headway', 'target', 'targetEnd']) {
        const input = el.querySelector(`[data-field="${key}"]`);
        if (input) p[key] = key === 'target' ? input.value : +input.value;
      }
      if (p.kind === 'express') p.calls = [...el.querySelectorAll('[data-call]:checked')].map(x => +x
        .dataset.call);
      return p;
    });
  }
  async function savePatterns() {
    const patterns = readPatterns();
    await commit(c => N.configure(c, selected, {
      patterns
    }), '运营规则已应用，班次与客流已重新计算。');
  }

  function addPattern() {
    const l = current(),
      patterns = readPatterns(),
      kind = $('new-pattern-kind').value;
    if (patterns.length >= 8) {
      toast('每条线路最多 8 个交路。');
      return;
    }
    const p = {
      kind,
      from: 0,
      to: l.stops.length - 1,
      fleet: 2,
      headway: l.headway,
      calls: [...l.stops]
    };
    if (kind === 'short') {
      if (l.stops.length < 3) {
        toast('小交路至少需要 3 座车站。');
        return;
      }
      p.to = l.stops.length - 2;
    }
    if (kind === 'cross') {
      const target = s.services.find(x => x.id !== l.id && x.stops.some(n => l.stops.includes(n)));
      if (!target) {
        toast('没有可接续线路。请先将另一条线路接入同一座车站。');
        return;
      }
      p.to = l.stops.findIndex(id => target.stops.includes(id));
      p.from = p.to === 0 ? (l.stops[0] === l.stops.at(-1) ? l.stops.length - 2 : l.stops.length - 1) : 0;
      p.target = target.id;
      p.targetEnd = target.stops.at(-1) !== l.stops[p.to] ? target.stops.length - 1 : 0;
    }
    const total = patterns.reduce((v, p) => v + p.fleet, 0);
    if (total + 2 > l.fleet) {
      const donor = patterns.find(p => p.fleet >= 4);
      if (!donor) {
        toast('配属车辆不足，请先购买并增加线路投放数量。');
        return;
      }
      donor.fleet -= 2;
    }
    patterns.push(p);
    $('pattern-list').innerHTML = patterns.map((p, i) => patternCard(l, p, i)).join('');
  }

  function path(l) {
    return X.linePoints(s, l).map((p, i) => {
      p = display(p);
      return `${i?'L':'M'}${p.x} ${p.y}`;
    }).join(' ');
  }

  function trainLine(t) {
    return s.services.find(l => l.id === (t.parentLine || t.service)) || t.retiringRun;
  }

  function runName(id) {
    const r = traffic.plan?.services.find(l => l.id === id);
    return r?.name || s.services.find(l => l.id === id)?.name || id;
  }

  function renderMap() {
    const svg = $('map'),
      used = new Set(s.services.flatMap(l => l.stops)),
      l = current(),
      active = new Set(l?.stops || []);
    let html = geography() + urbanGeometry();
    for (const line of [...s.services].sort((a, b) => (a.id === selected ? 1 : 0) - (b.id === selected ?
        1 : 0))) {
      const d = path(line),
        opacity = selected && line.id !== selected ? .22 : 1;
      html +=
        `<g class="route" data-line="${line.id}" role="button" tabindex="0" aria-label="线路 ${esc(line.name)}"><path class="route-visible" d="${d}" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"/><path class="route-visible" d="${d}" fill="none" stroke="${line.color}" stroke-width="${line.id===selected?4.8:3.5}" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"/><path class="route-hit" d="${d}"/><title>${esc(line.name)} · 点击查看线路信息</title></g>`;
    }
    for (const n of s.nodes) {
      if (n.mergedInto !== undefined) continue;
      const isUsed = used.has(n.id);
      if (!isUsed && !mode) continue;
      const p = display(n),
        stationLines = s.services.filter(l => l.stops.includes(n.id)),
        important = stationLines.length > 1 || HubList.some(h => X.distance(n, h) <= .8),
        terminal = stationLines.some(x => x.stops[0] === n.id || x.stops.at(-1) === n.id),
        priority = active.has(n.id) ? (important || terminal ? 5 : 3) : important ? 2 : terminal ? 1 : 0,
        color = active.has(n.id) ? l.color : stationLines[0]?.color || '#9ab0bf',
        opacity = selected && !active.has(n.id) && !mode ? .35 : 1;
      html +=
        `<g data-radius="${stationLines.length>1?4.5:isUsed?3.6:2.8}" data-priority="${priority}" class="station ${mode==='remove'&&active.has(n.id)?'stop-remove':''}" data-node="${n.id}" role="button" tabindex="0" aria-label="车站 ${esc(n.name)}"><rect class="station-hit-label" fill="transparent"/><circle class="station-hit" cx="${p.x}" cy="${p.y}"/><circle class="station-ring" cx="${p.x}" cy="${p.y}" fill="${isUsed?'#fff':'#e2eaf0'}" stroke="${color}" stroke-width="${isUsed?1.7:1}" opacity="${opacity}"/><text class="station-label" text-anchor="start" opacity="${opacity}">${esc(n.name)}</text><text class="queue-label" data-queue-label="${n.id}" text-anchor="start"></text></g>`;
    }
    html += hubMarkers();
    if (l && !mode) html += distanceLabels(l.stops, 'route-spacing', l);
    html += '<g id="train-layer"></g>';
    if (draft.length && mode === 'add') {
      html += distanceLabels(draft, 'draft-spacing');
      const raw = draft.map(p => V.resolve(s, p)),
        points = raw.map(display),
        curve = X.smooth(raw).map(display);
      html +=
        `<path d="${curve.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}" class="draft-line" fill="none" stroke="#276b9c" stroke-width="3" stroke-linecap="round"/>`;
      for (const [i, p] of points.entries()) html +=
        `<circle cx="${p.x}" cy="${p.y}" data-screen-radius="5" fill="#fff" stroke="#276b9c" stroke-width="2"/><text x="${p.x}" data-y="${p.y}" data-draft-label="1" class="draft-label" text-anchor="middle" fill="#245d83">${draft[i]?.waypoint?'◆':draft.slice(0,i+1).filter(p=>!p?.waypoint).length}</text>`;
    }
    html += '<g id="build-preview" aria-hidden="true"></g>';
    svg.innerHTML = html;
    cacheMapElements();
    applyCameraNow();
    if (placementPulse && !reducedMotion.matches) {
      const p = display(placementPulse),
        el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      el.setAttribute('cx', p.x);
      el.setAttribute('cy', p.y);
      el.setAttribute('r', 12 / pixelScale());
      el.setAttribute('class', 'placement-pulse');
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', '#236f9b');
      el.setAttribute('stroke-width', '2');
      svg.append(el);
      setTimeout(() => el.remove(), 650);
    }
    placementPulse = null;
  }

  function renderDots() {
    const el = $('train-layer');
    if (!el) return;
    if (trainElementLayer !== el) {
      trainElementLayer = el;
      trainElements = new Map();
    }
    const v = viewCache || mapView(),
      px = v.px,
      at = performance.now(),
      level = lodLevel || DETAIL.level(v.pixelsPerKm, interfacePrefs.detail),
      infoInterval = PERF.resolve(interfacePrefs, traffic.trains.length).hud,
      lines = new Map(s.services.map(l => [l.id, l])),
      points = [];
    if (level !== 'stations')
      for (const t of traffic.trains) {
        const line = t.parentLine || t.service,
          l = lines.get(line) || t.retiringRun;
        if (!l) continue;
        const p = display(O.position(traffic.plan, t, 1 / px)),
          point = {
            id: t.id,
            line,
            dir: t.dir,
            x: (p.x - v.box.x) * px,
            y: (p.y - v.box.y) * px,
            onboard: t.onboard,
            capacity: t.capacity,
            train: t
          };
        if (DETAIL.inside(point, v, 20)) points.push(point);
      }
    const markers = DETAIL.trains(points, level, selected),
      keys = new Set(markers.map(m => m.key));
    for (const [key, g] of trainElements)
      if (!keys.has(key)) {
        g.remove();
        trainElements.delete(key);
      } drawnTrainMarkers = markers.length;
    for (const m of markers) {
      const l = lines.get(m.line) || m.train?.retiringRun;
      if (!l) continue;
      let g = trainElements.get(m.key);
      if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('train-dot');
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.innerHTML =
          '<circle data-screen-radius="8" fill="transparent"/><circle class="load-ring" data-screen-radius="5.5" fill="#ffffffed" stroke-width="2.2"/><circle data-screen-radius="3.2" stroke="#fff" stroke-width="1.4"/><text class="train-load" text-anchor="middle"></text><title></title>';
        g._circles = [...g.querySelectorAll('circle')];
        g._label = g.querySelector('text');
        g._title = g.querySelector('title');
        trainElements.set(m.key, g);
        el.append(g);
      }
      if (m.individual) {
        g.dataset.train = m.id;
        delete g.dataset.line;
      } else {
        g.dataset.line = m.line;
        delete g.dataset.train;
      }
      g.classList.toggle('train-cluster', !m.individual);
      g.setAttribute('transform',
        `translate(${(v.box.x+m.x/px).toFixed(2)} ${(v.box.y+m.y/px).toFixed(2)})`);
      const detailKey = [px, selected, interfacePrefs.trainLabels, level, m.count, l.color].join('|');
      if (g._detailKey === detailKey && at - (g._infoAt || 0) < infoInterval) continue;
      g._detailKey = detailKey;
      g._infoAt = at;
      for (const c of g._circles) c.setAttribute('r', (+c.dataset.screenRadius + (m.count > 1 ? 1 : 0)) /
        px);
      g._circles[2].setAttribute('fill', l.color);
      g._circles[1].setAttribute('stroke', crowd(m.onboard / m.capacity));
      g._label.textContent = m.individual ? Math.round(m.onboard / m.capacity * 100) + '%' : m.count > 1 ?
        m.count + '列' : '';
      g._label.setAttribute('y', -10 / px);
      g._label.style.display = m.individual ? (interfacePrefs.trainLabels && (level === 'full' ||
        selected === m.line) ? '' : 'none') : (m.count > 1 ? '' : 'none');
      const name = m.individual ? `列车 ${m.id} · 满载率 ${Math.round(m.onboard/m.capacity*100)}%` :
        `${l.name} · ${m.count} 列列车`;
      g.setAttribute('aria-label', name);
      g._title.textContent = m.individual ?
        `${runName(m.train.service)} ${m.id} · ${num(m.onboard)} / ${m.capacity} 人` :
        `${l.name} · 聚合 ${m.count} 列 · 点击查看线路`;
      g.style.opacity = selected && selected !== m.line ? '.2' : '1';
    }
  }

  function updateHUD() {
    memoryAudit.tick(performance.now(), s, forecast, traffic, saveQueue);
    const hudSummary = O.summary(traffic);
    const day = s.ridership?.current?.number === Q.day(traffic.minute) ? {
      ...s.ridership.current,
      day: s.ridership.current.number
    } : {
      day: Q.day(traffic.minute),
      completed: 0,
      revenue: 0
    };
    DOM.text($('today-flow-value'), num(day.completed));
    DOM.text($('today-flow-day'), '第 ' + day.day + ' 天');
    DOM.text($('today-flow-revenue'), money(day.revenue));
    if (overview && !utilityPanel && !centerReview && !document.activeElement?.matches(
        '#overview-panel input,#overview-panel select')) {
      if (centerAnalysis && centerRendered !== centerAnalysis) renderOverview(true);
      centerRows();
    }
    syncRecords();
    if (s.urban.revision !== urbanDrawRevision) {
      refreshUrbanMap();
      renderMap();
      drawDensity();
    }
    if (s.urban.revision !== urbanForecastRevision && !calculating && !urbanJob && !forecastTimer)
      scheduleForecast();
    updateAlarms();
    if (traffic.minute - lastForecastRefresh >= 60 && !mode && !dispatchDirty && !document.activeElement
      ?.matches('input,select,textarea')) {
      lastForecastRefresh = traffic.minute;
      if (current() && !dispatchDirty) renderPanel();
      if (overview && !utilityPanel && !centerReview) centerRows();
    }
    DOM.text($('hud-cash'), money(s.economy.cash));
    DOM.text($('hud-trains'), traffic.trains.length + ' 列');
    DOM.text($('hud-waiting'), num(hudSummary.waiting) + ' 人');
    $('hud-cash').classList.toggle('negative', s.economy.blocked);
    DOM.text($('clock'), clock(traffic.minute));
    DOM.text($('game-day'), '第 ' + (Math.floor((traffic.minute - 420) / 1440) + 1) + ' 天');
    $('account-toggle').classList.toggle('funds-low', s.economy.blocked);
    const count = $('line-running');
    if (count) count.textContent = traffic.trains.filter(t => (t.parentLine || t.service) === selected)
      .length;
    document.querySelectorAll('[data-online]').forEach(el => {
      const l = s.services.find(l => l.id === el.dataset.online);
      el.textContent = l ? traffic.trains.filter(t => (t.parentLine || t.service) === l.id).length +
        ' / ' + F.planned(l, traffic.minute) : '—';
    });
    const all = $('overview-live');
    if (all) all.textContent = traffic.trains.length;
    const live = $('live-trains');
    if (live && current() && lineTab === 'dispatch' && live.closest('details')?.open) htmlIfChanged(live,
      traffic.trains.filter(t => (t.parentLine || t.service) === selected).map(t =>
        `<button data-train="${t.id}"><span>${t.id}</span><i style="--load:${Math.min(100,t.onboard/t.capacity*100)}%;--crowd:${crowd(t.onboard/t.capacity)}"></i><b>${num(t.onboard)} / ${t.capacity} · ${Math.round(t.onboard/t.capacity*100)}%</b></button>`
      ).join('') || '<p>当前无列车在线</p>');
    renderActivity();
    if (account) updateAccountLive();
    if (stationMenu) updateStationRows();
    for (const [id, value] of Object.entries({
        'audit-generated': traffic.generated,
        'audit-boarded': traffic.boarded,
        'audit-completed': traffic.completed
      })) {
      if ($(id)) $(id).textContent = num(value);
    }
    const status = $('audit-status');
    if (status) status.textContent = playing ? '正在运营' : '已暂停 · 点击右上角开始运营';
    DOM.text($('network-wait-count'), num(hudSummary.waiting));
    updateQueueLabels();
  }

  function crowd(rate) {
    return rate >= .9 ? '#d75c4c' : rate >= .65 ? '#d69b39' : '#2e9b87';
  }

  function updateQueueLabels() {
    if (lodLevel !== 'full' || !interfacePrefs.queueLabels) {
      for (const e of stationElements)
        if (e.queue) e.queue.style.display = 'none';
      return;
    }
    const counts = queueTotals();
    for (const e of stationElements)
      if (e.queue) {
        const value = counts[e.id] || 0;
        e.queue.textContent = value >= 1 ? '候 ' + num(value) : '';
        e.queue.style.display = e.visible ? '' : 'none';
      }
  }

  function renderEditBar() {
    if (mode === 'plan') {
      renderFacilityBuild();
      return;
    }
    const bar = $('edit-bar');
    $('map-hint').textContent = mode === 'add' ? '左键设站 · 右键固定转弯 · 拖动浏览' : mode === 'insert' ?
      '右键固定转弯 · 左键增站 · 移动预览站距' : mode === 'remove' ? '点击线路上的车站或右侧减号移除' : '滚轮 / 双击放大街道 · 点击线路查看详情';
    if (!mode) return;
    const l = current(),
      rawPoints = mode === 'add' ? draft : l?.stops || [],
      points = rawPoints.filter(p => !p?.waypoint),
      legs = mode === 'add' ? V.segments(s, rawPoints) : V.lineSegments(s, l),
      total = legs.reduce((v, e) => v + e.km, 0),
      closed = points.length > 2 && X.distance(V.resolve(s, points[0]), V.resolve(s, points.at(-1))) <
      1e-6,
      plan = mode === 'add' && draft.length >= 2 ? M.preview(s, c => N.addLine(c, draft, {
        stockSpec: draftSpec
      })) : null,
      title = mode === 'add' ? '新建线路' : mode === 'insert' ? '增设车站' : '移除车站';
    bar.innerHTML =
      `<div class="panel-header"><div class="panel-heading"><h2>${title}</h2><button id="cancel-edit" class="panel-close" aria-label="关闭线路建设">×</button></div><div class="panel-subtitle">${closed?points.length-1:points.length} 站 · ${closed?'闭合环线 · ':''}全长 ${V.formatDistance(total)}</div></div><div class="panel-scroll build-content"><p class="build-instruction">${mode==='add'?'左键设站，右键固定转弯点。再次左键设置下一站。':mode==='insert'?'右键添加转弯固定点，左键设置新站。'+(draft.length?' 已固定 '+draft.length+' 个点。':''):'选择要移除的车站，相邻区段将自动连接。'}</p><div id="live-spacing" class="live-spacing">${mode==='add'&&!draft.length?'点击地图设置第一站':'移动鼠标查看下一段站距'}</div><div class="build-stations">${points.map((p,i)=>{const n=V.resolve(s,p),name=n.name||RailPlaceNames.suggest(s,n,n.nameSeed??.5).name;return `${i?`<div class="build-gap"><i></i><span>${V.formatDistance(legs[i-1].km)}</span></div>`:''}<div class="build-stop"><b>${i+1}</b><span>${esc(name)}</span>${mode==='remove'?`<button data-remove="${p}" ${points.length<=2?'disabled':''} aria-label="移除 ${esc(name)}">−</button>`:''}</div>`;}).join('')||'<div class="build-empty">从第一座车站开始</div>'}</div><p class="spacing-note">站距、费用和列车行进均按实际曲线计算。固定点不设站；60 米内自动接入同站。0–170°内角连续平滑，转弯范围随区间加大。</p>${mode==='add'?`<div class="config-row"><label for="draft-spec">线路规格</label><select id="draft-spec">${specOptions(draftSpec)}</select></div><p class="station-note">建成后车型与编组锁定。建设不附赠列车，请到车库购买并投放。</p><div class="build-quote"><span>预计投入</span><strong>${plan?.error?esc(plan.error):plan?money(Math.max(0,plan.net)):'—'}</strong></div>`:''}</div><div class="build-footer">${mode==='add'?`<button id="undo-draft" ${!draft.length?'disabled':''}>退一步</button><button id="confirm-add" class="primary" ${draft.filter(p=>!p?.waypoint).length<2||draft.at(-1)?.waypoint||plan?.error||plan?.net>s.economy.cash?'disabled':''}>完成线路</button>`:`${mode==='insert'&&draft.length?'<button id="undo-draft">撤销固定点</button>':''}<button id="finish-edit" class="primary">完成编辑</button>`}</div>`;
  }

  function distanceLabels(points, kind, line = null) {
    return (line ? V.lineSegments(s, line) : V.segments(s, points)).map(e => {
      const middle = display(X.along(e.points, .5)),
        a = middle,
        b = middle,
        text = V.formatDistance(e.km);
      return `<g class="spacing-label ${kind}" transform="translate(${(a.x+b.x)/2} ${(a.y+b.y)/2})" data-distance-km="${e.km}" data-label-size="${text.length}"><rect/><text text-anchor="middle">${text}</text></g>`;
    }).join('');
  }

  function updateDistanceSymbols() {
    const px = pixelScale();
    for (const g of $('map').querySelectorAll('.spacing-label')) {
      const w = (+g.dataset.labelSize * 6.5 + 18) / px,
        r = g.querySelector('rect'),
        t = g.querySelector('text');
      r.setAttribute('x', -w / 2);
      r.setAttribute('y', -11 / px);
      r.setAttribute('width', w);
      r.setAttribute('height', 22 / px);
      r.setAttribute('rx', 6 / px);
      t.setAttribute('y', 4 / px);
    }
  }

  function renderInsertPreview(el) {
    el.innerHTML = '';
    const l = current();
    if (!l) return;
    el.innerHTML = distanceLabels(l.stops, 'route-spacing', l);
    const point = hoverPoint || draft.at(-1);
    if (point) {
      try {
        const plan = N.stationInsertion(s, l, point, {
            bends: draft,
            index: insertIndex ?? undefined
          }),
          raw = [];
        plan.stops.forEach((p, i) => {
          raw.push(p);
          if (plan.shapes[i]) raw.push(...plan.shapes[i].map(p => ({
            ...p,
            waypoint: true
          })));
        });
        const legs = X.draftLegs(s, raw).filter((_, i) => i === plan.index - 1 || i === plan.index);
        for (const leg of legs) {
          const points = leg.points.map(display),
            mid = display(X.along(leg.points, .5)),
            text = V.formatDistance(leg.km);
          el.innerHTML +=
            `<path class="preview-track" d="${points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}"/><g class="spacing-label preview-spacing" transform="translate(${mid.x} ${mid.y})" data-distance-km="${leg.km}" data-label-size="${text.length}"><rect/><text text-anchor="middle">${text}</text></g>`;
        }
        if (hoverPoint) {
          const p = display(V.resolve(s, hoverPoint));
          el.innerHTML +=
            `<circle class="preview-station" cx="${p.x}" cy="${p.y}" r="${5/pixelScale()}"/>`;
        }
        const live = $('live-spacing');
        if (live) live.textContent = hoverPoint ? '新站至相邻站：' + legs.map(e => V.formatDistance(e.km)).join(
          ' / ') : '已固定 ' + draft.length + ' 个转弯点，左键设置新站。';
      } catch (error) {
        const live = $('live-spacing');
        if (live) live.textContent = error.message;
      }
    }
    for (const b of draft) {
      const p = display(b),
        d = 6 / pixelScale();
      el.innerHTML +=
        `<path class="insert-waypoint" d="M${p.x} ${p.y-d}L${p.x+d} ${p.y}L${p.x} ${p.y+d}L${p.x-d} ${p.y}Z" fill="#fff" stroke="#276b9c" stroke-width="2"/>`;
    }
    updateDistanceSymbols();
  }

  function renderConstructionPreview() {
    const el = $('build-preview');
    if (!el) return;
    if (mode === 'insert') {
      renderInsertPreview(el);
      return;
    }
    if (mode === 'plan') {
      if (hoverPoint) {
        const p = display(hoverPoint);
        el.innerHTML =
          `<circle class="facility-range" cx="${p.x}" cy="${p.y}" r="${U.TYPES[facilityKind].radius[0]/.045}"/>`;
      } else el.innerHTML = '';
      return;
    }
    el.innerHTML = '';
    if (!mode || mode === 'remove' || utilityPanel) return;
    let base = mode === 'add' ? draft : current()?.stops || [],
      points = base,
      changed = [];
    if (hoverPoint) {
      if (mode === 'add') {
        points = [...base, hoverPoint];
        changed = base.length ? [...base.slice(Math.max(0, base.map((p, i) => !p?.waypoint ? i : -1)
          .filter(i => i >= 0).at(-1) || 0)), hoverPoint] : [];
      } else if (current()) {
        const plan = V.insertion(s, current(), hoverPoint);
        points = plan.stops;
        changed = points.slice(Math.max(0, plan.index - 1), Math.min(points.length, plan.index + 2));
      }
    }
    if (mode === 'insert') el.innerHTML = distanceLabels(base, 'route-spacing', current());
    if (hoverPoint) {
      const p = display(V.resolve(s, hoverPoint)),
        path = changed.map(p => display(V.resolve(s, p)));
      el.innerHTML +=
        `<path class="preview-track" d="${path.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}"/>${distanceLabels(changed,'preview-spacing')}<circle class="preview-station" cx="${p.x}" cy="${p.y}" r="${5/pixelScale()}"/>`;
      const text = V.segments(s, changed).map(e => V.formatDistance(e.km)).join(' / '),
        live = $('live-spacing');
      if (live) live.textContent = (Number.isInteger(hoverPoint) ? '接入「' + s.nodes[hoverPoint].name +
        '」 · ' : '') + (text ? (mode === 'insert' ? '新站至相邻站：' : '至上一站：') + text : '点击设置第一座车站');
    }
    updateDistanceSymbols();
  }

  function selectLine(id) {
    if (overview) centerReturn = true;
    utilityPanel = null;
    hoverPoint = null;
    stationMenu = false;
    account = false;
    inspection = null;
    overview = false;
    selected = id;
    mode = null;
    draft = [];
    deleteConfirm = false;
    render();
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => fitLine(id), 310);
  }

  function begin(kind) {
    if (!mode) resumeAfterEdit = playing;
    utilityPanel = null;
    hoverPoint = null;
    clearTimeout(focusTimer);
    cameraTween = null;
    stationMenu = false;
    account = false;
    inspection = null;
    overview = false;
    mode = kind;
    draft = [];
    insertIndex = null;
    deleteConfirm = false;
    render();
  }

  function snapPoint(point) {
    if (Number.isInteger(point)) return point;
    const existing = N.snap(s, point);
    if (existing !== null) return existing;
    for (const p of draft)
      if (!p?.waypoint && X.distance(V.resolve(s, p), point) <= N.SNAP_KM) return p;
    return point;
  }
  async function pick(point) {
    if (calculating) return;
    if (mode === 'plan') {
      const p = V.resolve(s, point);
      const result = await commit(c => U.plan(c, C.create(region), facilityKind, p),
        '市政设施已建成，周边开发倾向已更新。');
      if (result) {
        mode = null;
        inspect('facility', result.facilityId);
      }
      return;
    }
    if (mode === 'add' || mode === 'insert') {
      point = snapPoint(point);
      if (!Number.isInteger(point)) point = {
        ...point,
        nameSeed: point.nameSeed ?? Math.random()
      };
    }
    if (mode === 'add') {
      if (draft.length >= (s.region ? 60 : 30)) {
        toast('当前地图的单线车站数量已达上限。');
        return;
      }
      if (Number.isInteger(point) && draft.includes(point) && !(point === draft[0] && draft.length >=
          3 && draft.at(-1) !== point)) {
        toast('该站已经在线路草图中。');
        return;
      }
      if (!Number.isInteger(point) && draft.length) {
        const last = draft.at(-1),
          p = Number.isInteger(last) ? s.nodes[last] : last;
        if (Math.hypot(p.x - point.x, p.y - point.y) < .04) return;
      }
      draft.push(point);
      placementPulse = V.resolve(s, point);
      hoverPoint = null;
      renderMap();
      renderEditBar();
      return;
    }
    if (mode === 'insert') {
      if (await commit(c => N.addStation(c, selected, point, {
          bends: draft,
          index: insertIndex ?? undefined
        }), '已增加车站并重连线路。')) {
        mode = null;
        render();
      }
      return;
    }
    if (mode === 'remove' && Number.isInteger(point)) {
      await commit(c => N.removeStation(c, selected, point), '已移除车站，相邻区段已重连。');
      return;
    }
    if (Number.isInteger(point)) {
      const l = s.services.find(l => l.stops.includes(point));
      if (l) selectLine(l.id);
    }
  }
  document.addEventListener('click', async e => {
    if(e.target.closest('[data-repay],#borrow-money,#save-line-identity,#save-station-name,#undo'))await M.whenIdle(traffic);
    if (calculating) return;
    const b = e.target.closest('button,[data-line],[data-node]');
    if (!b || b.closest('#map')) return;
    if (b.dataset.reviewLine) {
      reviewLine = b.dataset.reviewLine;
      inspect('reviews', null);
      return;
    }
    if (b.dataset.reviewObserve) {
      REVIEW.observe(s, traffic, b.dataset.reviewObserve);
      if (demandState.status === 'ready') REVIEW.ready(s, traffic.minute);
      save();
      renderActivity();
      return;
    }
    if (b.dataset.reviewFilter) {
      reviewFilter = b.dataset.reviewFilter;
      renderActivity();
      return;
    }
    if (b.dataset.urbanTab) {
      urbanTab = b.dataset.urbanTab;
      renderActivity();
      return;
    }
    if (b.dataset.development) {
      const p = s.urban.development?.projects.find(p => p.id === b.dataset.development);
      if (p) {
        inspect('development', p.id);
        const q = display(p);
        flyTo(q.x, q.y, Math.max(20, zoom));
      }
      return;
    }
    if (b.dataset.focusDevelopment) {
      const p = s.urban.development?.projects.find(p => p.id === b.dataset.focusDevelopment);
      if (p) {
        const q = display(p);
        flyTo(q.x, q.y, 32);
      }
      return;
    }
    if (b.dataset.lineTab) {
      showLineTab(b.dataset.lineTab);
      return;
    }
    if (utilityPanel && !b.closest('#source-panel,#newgame-panel,#layers-panel,#world-panel'))
      closeUtility();
    if (b.dataset.centerFilter) {
      centerFilter = b.dataset.centerFilter;
      renderOverview();
      return;
    }
    if (b.dataset.centerDispatch) {
      const row = centerRows().find(x => x.id === b.dataset.centerDispatch);
      if (row) {
        centerReview = {
          id: row.id,
          preview: OC.preview(s, row)
        };
        renderOverview();
        document.querySelector('.center-review')?.scrollIntoView({
          block: 'center',
          behavior: 'smooth'
        });
      }
      return;
    }
    if (b.dataset.centerPattern) {
      prepareCenterPattern(b.dataset.centerPattern, b.dataset.centerKey);
      return;
    }
    if (b.dataset.centerBuy) {
      const row = centerRows().find(x => x.id === b.dataset.centerBuy);
      if (row) {
        depotSpec = row.l.stockSpec;
        depotQty = Math.max(2, row.shortage);
        inspect('depot', null);
      }
      return;
    }
    if (b.dataset.world) {
      if (b.dataset.world === region) {
        closeUtility();
        return;
      }
      if (!await save()) {
        toast('当前进度尚未保存，请先导出文件后再切换地图。');
        return;
      }
      const url = new URL(location.href);
      url.searchParams.set('map', b.dataset.world);
      url.searchParams.set('v', UI_VERSION);
      location.assign(url.href);
      return;
    }
    if (b.dataset.focusCity !== undefined) {
      const c = RailGBA.cities[+b.dataset.focusCity],
        p = display(B.project(c.centres[0][1], c.centres[0][0], region));
      closeUtility();
      flyTo(p.x, p.y, innerWidth < 650 ? 32 : 24);
      return;
    }
    if (b.dataset.dropPattern !== undefined) {
      const l = current(),
        patterns = R.clone(X.patterns(l));
      patterns.splice(+b.dataset.dropPattern, 1);
      if (!patterns.length) {
        toast('至少保留一个交路。');
        return;
      }
      await commit(c => N.configure(c, l.id, {
        patterns
      }), '已删除交路。');
      return;
    }
    if (b.dataset.repay) {
      const r = M.repay(s, +b.dataset.repay);
      undoState = null;
      save();
      renderAccount();
      updateHUD();
      toast(r.error || '贷款已结清。');
      return;
    }
    if (b.dataset.hub) {
      const h = HubList.find(h => h.id === b.dataset.hub),
        locate = !!b.closest('#activity-panel');
      inspect('hub', h.id);
      if (locate) {
        const p = display(h);
        flyTo(p.x, p.y, Math.max(18, zoom));
      }
      return;
    }
    if (b.dataset.destination) {
      const f = s.urban.facilities.find(f => f.id === b.dataset.destination);
      if (f) {
        inspect('facility', f.id);
        const p = display(f);
        flyTo(p.x, p.y, Math.max(32, zoom));
      }
      return;
    }
    if (b.dataset.focusFacility) {
      const f = s.urban.facilities.find(f => f.id === b.dataset.focusFacility);
      if (f) {
        const p = display(f);
        flyTo(p.x, p.y, Math.max(48, zoom));
      }
      return;
    }
    if (b.dataset.facility) {
      inspect('facility', b.dataset.facility);
      return;
    }
    if (b.dataset.openAlarms) {
      inspect('alarms', null);
      return;
    }
    if (b.dataset.alertStation) {
      const id = +b.dataset.alertStation,
        l = s.services.find(l => l.stops.includes(id));
      if (l) {
        stationLine = l.id;
        inspect('station', id);
      }
      return;
    }
    if (b.dataset.train) {
      inspect('train', b.dataset.train);
      return;
    }
    if (b.dataset.station) {
      const id = +b.dataset.station,
        n = display(s.nodes[id]);
      if (b.closest('#line-panel') && current()) {
        stationLine = selected;
        inspect('station', id);
      } else {
        const l = s.services.find(l => l.stops.includes(id));
        if (l) {
          selectLine(l.id);
          flyTo(n.x, n.y, Math.max(30, zoom));
        }
      }
      return;
    }
    if (b.dataset.line) {
      if (mode === 'add' || mode === 'insert') return;
      selectLine(b.dataset.line);
      return;
    }
    if (b.dataset.node !== undefined) {
      pick(+b.dataset.node);
      return;
    }
    if (b.dataset.remove !== undefined) {
      await commit(c => N.removeStation(c, selected, +b.dataset.remove), '已移除车站，相邻区段已重连。');
      return;
    }
    if (b.dataset.locate !== undefined) {
      const n = display(s.nodes[+b.dataset.locate]);
      flyTo(n.x, n.y, Math.max(40, zoom));
      return;
    }
    if (b.dataset.achievementFilter) {
      achievementFilter = b.dataset.achievementFilter;
      renderActivity();
      return;
    }
    switch (b.id) {
      case 'reviews-toggle':
        reviewLine = '';
        inspect('reviews', null);
        break;
      case 'review-back-center':
        inspection = null;
        overview = true;
        render();
        break;
      case 'diagnostics-open':
        inspect('diagnostics', null);
        break;
      case 'retry-demand':
        scheduleForecast();
        toast('已安排后台重算，现有列车与乘客保留。');
        break;
      case 'today-flow-card':
      case 'daily-open':
        inspect('daily', null);
        break;
      case 'achievements-toggle':
      case 'achievements-open':
        inspect('achievements', null);
        break;
      case 'saves-toggle':
        setPlaying(false);
        inspect('saves', null);
        break;
      case 'save-local-now':
        if (await save()) toast('已保存到本机数据库。');
        break;
      case 'export-local-save':
        downloadLocalSave();
        break;
      case 'choose-local-save':
        choosingLocalFile = true;
        $('local-save-file').click();
        break;
      case 'cancel-local-import':
        cancelLocalImport();
        break;
      case 'confirm-local-import':
        await applyLocalSave();
        break;
      case 'back-center':
        selected = null;
        mode = null;
        inspection = null;
        overview = true;
        centerReturn = false;
        centerReview = null;
        render();
        break;
      case 'center-confirm':
        await centerApply();
        break;
      case 'center-cancel':
        centerReview = null;
        renderOverview();
        break;
      case 'center-refresh':
        centerRows(true);
        renderOverview();
        break;
      case 'urban-toggle':
        inspect('urban', null);
        break;
      case 'toggle-density':
        setDensity(density === 'off');
        break;
      case 'back-to-urban':
        inspect('urban', null);
        break;
      case 'upgrade-facility': {
        const id = inspection.id;
        const r = await commit(c => U.upgrade(c, id), '设施等级与覆盖范围已提升。');
        if (r) inspect('facility', id);
        break;
      }
      case 'remove-facility': {
        const id = inspection.id;
        const r = await commit(c => U.remove(c, id), '设施已拆除，周边服务与开发倾向已重算。');
        if (r) inspect('urban', null);
        break;
      }
      case 'cancel-facility':
        mode = null;
        inspect('urban', null);
        break;
      case 'depot-toggle':
      case 'open-depot':
        inspect('depot', null);
        break;
      case 'alarms-toggle':
        inspect('alarms', null);
        break;
      case 'buy-stock': {
        const r = await commit(c => F.purchase(c, depotSpec, depotQty), '已购入 ' + depotQty + ' 列 ' +
          depotSpec);
        if (r) {
          renderActivity();
          updateHUD();
        }
        break;
      }
      case 'recommend-dispatch':
        recommendDispatch();
        break;
      case 'save-dispatch': {
        const d = {
          mode: $('dispatch-mode').value,
          manual: +$('dispatch-manual').value,
          offPeak: +$('dispatch-offpeak').value,
          peak: +$('dispatch-peak').value
        };
        await commit(c => N.configure(c, selected, {
          dispatch: d
        }), '投放计划已更新，行车间隔已自动计算。');
        break;
      }
      case 'world-toggle':
        openUtility('world');
        break;
      case 'close-world':
        closeUtility();
        break;
      case 'records-open':
      case 'records-toggle':
        inspect('records', null);
        break;
      case 'hubs-toggle':
      case 'back-to-hubs':
        inspect('hubs', null);
        break;
      case 'save-line-identity': {
        const name = $('line-name').value.trim(),
          color = $('line-color').value,
          r = N.configure(s, selected, {
            name,
            color
          });
        if (r.error) {
          toast(r.error);
          break;
        }
        await O.materializeAsync(traffic);
        O.reconcile(traffic, s);
        save();
        render();
        toast('线路名称与颜色已更新。');
        break;
      }
      case 'save-station-name': {
        const r = N.renameStation(s, inspection.id, $('station-name').value);
        if (r.error) {
          toast(r.error);
          break;
        }
        await O.materializeAsync(traffic);
        O.reconcile(traffic, s);
        save();
        render();
        toast('站名已更新。');
        break;
      }
      case 'back-to-line':
        if (stationLine && s.services.some(l => l.id === stationLine)) selectLine(stationLine);
        break;
      case 'layers-toggle':
        openUtility('layers');
        break;
      case 'close-layers':
        closeUtility();
        break;
      case 'use-vector':
        if (region === 'gba') {
          toast('大湾区使用轻量图片底图，可切换 Esri、OSM 或简洁示意。');
          break;
        }
        basemap = 'vector';
        $('basemap-select').value = basemap;
        saveMapPrefs();
        render();
        applyCamera();
        break;
      case 'save-fares': {
        const fareBands = [...document.querySelectorAll('[data-fare-band]')].map(el => RailCurrency
          .fromCNY(+el.value));
        await commit(c => N.configure(c, selected, {
          fareBands
        }), '票价已更新，客流与路线选择已重新计算。');
        break;
      }
      case 'save-patterns':
        await savePatterns();
        break;
      case 'add-pattern':
        addPattern();
        break;
      case 'reset-patterns':
        await commit(c => N.configure(c, selected, {
          patterns: undefined
        }), '已恢复普通全程交路。');
        break;
      case 'overview-toggle':
        stationMenu = false;
        overview = !overview;
        account = false;
        inspection = null;
        selected = null;
        mode = null;
        draft = [];
        render();
        break;
      case 'close-overview':
        overview = false;
        render();
        break;
      case 'fit-region':
        clearTimeout(focusTimer);
        flyTo(mapBounds.x + mapBounds.w / 2, mapBounds.y + mapBounds.h / 2, viewSpan().minZoom,
          600);
        break;
      case 'fit-core':
        resetCamera();
        break;
      case 'retry-map':
        if (basemap === 'vector') vectorLayer.retry();
        else tilesLayer.retry();
        break;
      case 'open-account-overview':
      case 'account-toggle':
        stationMenu = false;
        account = !account;
        overview = false;
        inspection = null;
        selected = null;
        mode = null;
        draft = [];
        render();
        break;
      case 'goto-stations':
      case 'stations-toggle':
        stationMenu = !stationMenu;
        account = false;
        overview = false;
        inspection = null;
        selected = null;
        mode = null;
        draft = [];
        render();
        break;
      case 'station-build-first':
        stationMenu = false;
        selected = null;
        begin('add');
        break;
      case 'close-stations':
        stationMenu = false;
        render();
        break;
      case 'density-info':
        openUtility('source');
        break;
      case 'close-source':
        closeUtility();
        break;
      case 'close-account':
        account = false;
        render();
        break;
      case 'close-activity':
        inspection = null;
        render();
        break;
      case 'borrow-money': {
        const r = M.borrow(s, +$('loan-amount').value);
        undoState = null;
        save();
        renderAccount();
        updateHUD();
        toast(r.error || '贷款已到账，按游戏日计息并自动偿还。');
        break;
      }
      case 'new-game':
        openUtility('newgame');
        break;
      case 'cancel-newgame':
      case 'close-newgame':
        closeUtility();
        break;
      case 'confirm-newgame':
        await startNewGame();
        break;
      case 'play':
        setPlaying(!playing);
        break;
      case 'add-line':
        selected = null;
        begin('add');
        break;
      case 'delete-line':
        if (current()) {
          lineTab = 'settings';
          deleteConfirm = true;
          renderPanel();
          document.querySelector('.confirm-delete').scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
          });
        }
        break;
      case 'cancel-delete':
        deleteConfirm = false;
        renderPanel();
        break;
      case 'confirm-delete': {
        const id = selected;
        if (await commit(c => N.removeLine(c, id), '线路已删除，其他线路保留。')) {
          selected = null;
          render();
        }
        break;
      }
      case 'close-panel':
        selected = null;
        mode = null;
        centerReturn = false;
        render();
        break;
      case 'add-station':
        begin(mode === 'insert' ? null : 'insert');
        break;
      case 'remove-station':
        begin(mode === 'remove' ? null : 'remove');
        break;
      case 'finish-edit':
      case 'cancel-edit':
        mode = null;
        hoverPoint = null;
        draft = [];
        render();
        break;
      case 'undo-draft':
        hoverPoint = null;
        draft.pop();
        if (!draft.length) insertIndex = null;
        renderMap();
        renderEditBar();
        break;
      case 'confirm-add': {
        const result = await commit(c => N.addLine(c, draft, {
          stockSpec: draftSpec
        }), '新线路已加入地图。');
        if (result) {
          selected = result.id;
          mode = null;
          draft = [];
          render();
        }
        break;
      }
      case 'zoom-in':
        zoomCenter(1.8);
        break;
      case 'zoom-out':
        zoomCenter(1 / 1.8);
        break;
      case 'zoom-reset':
        resetCamera();
        break;
      case 'undo':
        if (undoState) {
          networkRevision++;
          s = undoState.state;
          const rt = undoState.runtime;
          forecast = undoState.forecast || forecast;
          undoState = null;
          mode = null;
          draft = [];
          O.dispose(traffic);
          traffic = O.restore(s, forecast, rt) || O.create(s, forecast, s.economy.minute, false);
          scheduleForecast();
          save();
          render();
          toast('已撤销建设并恢复对应余额。');
        }
        break;
    }
  });
  document.addEventListener('change', async e => {
    if (e.target.id === 'review-line-filter') {
      reviewLine = e.target.value;
      renderActivity();
      return;
    }
    if (calculating) return;
    const id = e.target.id;
    if (['flow-day', 'flow-metric', 'flow-interval'].includes(id)) {
      if (id === 'flow-day') flowDay = e.target.value;
      if (id === 'flow-metric') flowMetric = e.target.value;
      if (id === 'flow-interval') flowInterval = +e.target.value;
      flowHovered = '';
      e.target.blur();
      renderActivity();
      return;
    }
    if (id === 'local-save-file') {
      choosingLocalFile = false;
      await readLocalSave(e.target.files?.[0]);
      return;
    }
    if (['dispatch-manual', 'dispatch-offpeak', 'dispatch-peak'].includes(id)) {
      markDispatchDirty();
      return;
    }
    if (id === 'dispatch-mode') {
      markDispatchDirty();
    }
    if (id === 'dispatch-mode') {
      document.querySelectorAll('[data-dispatch-row]').forEach(el => el.hidden = el.dataset
        .dispatchRow !== e.target.value);
      if (e.target.value === 'auto' && current().dispatch.mode !== 'auto') recommendDispatch();
      return;
    }
    if (id === 'draft-spec') {
      draftSpec = e.target.value;
      renderEditBar();
      return;
    }
    if (id === 'depot-spec') {
      depotSpec = e.target.value;
      if ($('depot-unit')) $('depot-unit').textContent = money(F.SPECS[depotSpec].price);
      return;
    }
    if (id === 'depot-qty') {
      depotQty = +e.target.value;
      return;
    }
    if (e.target.dataset.field === 'target') {
      const card = e.target.closest('[data-pattern-index]'),
        line = s.services.find(l => l.id === e.target.value);
      card.querySelector('[data-field="targetEnd"]').innerHTML = stopOptions(line, line.stops
        .length - 1);
      return;
    }
    if (e.target.dataset.baseLayer) {
      vectorLayer.set(e.target.dataset.baseLayer, e.target.checked);
      saveMapPrefs();
      return;
    }
    if (id === 'loop-direction' && current()) {
      await commit(c => N.configure(c, selected, {
        loopDirection: e.target.value
      }), '环线方向与客流路径已更新。');
      return;
    }
    if (id === 'basemap-select') {
      basemap = region === 'gba' && !['esri', 'osm', 'schematic'].includes(e.target.value) ?
        'esri' : e.target.value;
      saveMapPrefs();
      render();
      applyCamera();
      return;
    }
    if (id === 'density-toggle') {
      setDensity(e.target.checked);
      return;
    }
    if (id === 'map-labels') {
      updateLabels(true);
      return;
    }
    if (id === 'overview-sort') {
      sort = e.target.value;
      renderOverview();
      updateHUD();
      return;
    }
    if (id === 'station-sort') {
      stationSort = e.target.value;
      updateStationRows();
      return;
    }
    if (id === 'speed') {
      speed = +e.target.value;
      save();
      return;
    }
    if (['open', 'close'].includes(id) && current()) {
      let value = +e.target.value;
      if (id === 'open' || id === 'close') {
        const [h, m] = e.target.value.split(':').map(Number);
        value = h * 60 + m;
        if (id === 'close' && value === 0) value = 1440;
      }
      await commit(c => N.configure(c, selected, {
        [id]: value
      }), '线路配置已更新。');
      renderPanel();
    }
  });

  function pointAt(e) {
    const svg = $('map'),
      p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const d = p.matrixTransform(svg.getScreenCTM().inverse()),
      m = G.model(d);
    return {
      x: Math.max(mapBounds.model.left, Math.min(mapBounds.model.right, m.x)),
      y: Math.max(mapBounds.model.top, Math.min(mapBounds.model.bottom, m.y))
    };
  }
  document.addEventListener('contextmenu', e => e.preventDefault(), {
    capture: true
  });
  $('map').addEventListener('contextmenu', e => {
    e.preventDefault();
    if ((mode === 'add' || mode === 'insert') && !utilityPanel && !calculating) {
      if (mode === 'add' && !draft.length) {
        toast('请先用左键设置起点车站。');
        return;
      }
      const p = {
        ...pointAt(e),
        waypoint: true
      };
      if (draft.length >= 120) {
        toast('最多120个固定点。');
        return;
      }
      if (mode === 'insert' && !draft.length) insertIndex = V.insertion(s, current(), p).index;
      draft.push(p);
      hoverPoint = null;
      renderMap();
      renderEditBar();
    }
  });
  $('map').addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    clearTimeout(focusTimer);
    cameraTween = null;
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });
    $('map').setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom
      };
      if (drag) drag.moved = true;
      return;
    }
    const span = viewSpan();
    drag = {
      x: e.clientX,
      y: e.clientY,
      cx: camera.x,
      cy: camera.y,
      w: span.w,
      h: span.h,
      moved: false,
      target: e.target
    };
  });
  $('map').addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) {
      if ((mode === 'add' || mode === 'insert' || mode === 'plan') && !utilityPanel) {
        const n = e.target.closest('[data-node]');
        hoverPoint = mode === 'plan' ? pointAt(e) : snapPoint(n ? +n.dataset.node : pointAt(e));
        renderConstructionPreview();
        if (mode === 'plan') updateFacilityPreview();
      }
      return;
    }
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance), (a.x + b
        .x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) {
      const r = $('map').getBoundingClientRect();
      camera = {
        x: drag.cx - dx / r.width * drag.w,
        y: drag.cy - dy / r.height * drag.h
      };
      applyCamera();
    }
  });
  $('map').addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pinch) {
      pinch = null;
      drag = null;
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved || utilityPanel) return;
    const node = d.target.closest('[data-node]'),
      line = d.target.closest('[data-line]'),
      train = d.target.closest('[data-train]'),
      hub = d.target.closest('[data-hub]'),
      facility = d.target.closest('[data-facility]');
    if (mode === 'plan') {
      pick(pointAt(e));
    } else if (mode === 'add' || mode === 'insert' || mode === 'remove') {
      pick(node ? +node.dataset.node : pointAt(e));
    } else if (density === 'urban') {
      inspect('area', pointAt(e));
    } else if (facility) {
      inspect('facility', facility.dataset.facility);
    } else if (hub) {
      inspect('hub', hub.dataset.hub);
    } else if (train) {
      inspect('train', train.dataset.train);
    } else if (node) {
      pick(+node.dataset.node);
    } else if (line) {
      selectLine(line.dataset.line);
    }
  });
  $('map').addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    pinch = null;
    drag = null;
  });
  $('map').addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt((cameraTween?.tz || zoom) * (e.deltaY < 0 ? 1.3 : 1 / 1.3), e.clientX, e.clientY, true);
  }, {
    passive: false
  });
  $('map').addEventListener('dblclick', e => {
    e.preventDefault();
    if (!mode) zoomAt(zoom * 2, e.clientX, e.clientY, true);
  });
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea') && e.key !== 'Escape') return;
    if (e.key === 'Escape' && utilityPanel) {
      closeUtility();
      return;
    }
    if (e.key === 'Escape') {
      mode = null;
      draft = [];
      deleteConfirm = false;
      if (!mode) selected = null;
      overview = false;
      stationMenu = false;
      account = false;
      inspection = null;
      render();
    }
    if (['Enter', ' '].includes(e.key)) {
      const t = e.target.closest('[data-line],[data-node],[data-train],[data-hub],[data-facility]');
      if (t) {
        e.preventDefault();
        if (t.dataset.facility) inspect('facility', t.dataset.facility);
        else if (t.dataset.hub) inspect('hub', t.dataset.hub);
        else if (t.dataset.train) inspect('train', t.dataset.train);
        else if (t.dataset.node !== undefined) pick(+t.dataset.node);
        else selectLine(t.dataset.line);
      }
    }
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyCamera, 100);
  });
  new ResizeObserver(() => applyCamera()).observe($('stage'));
  $('map').addEventListener('pointerleave', () => {
    hoverPoint = null;
    renderConstructionPreview();
  });
  document.addEventListener('visibilitychange', () => {
    lastFrame = 0;
    simulationClock.reset();
    if (document.hidden) save();
  });
  window.addEventListener('pagehide', save);

  function frame(now) {
    const perf = PERF.resolve(interfacePrefs, traffic.trains.length);
    if (document.hidden) {
      lastFrame = 0;
      requestAnimationFrame(frame);
      return;
    }
    if (cameraTween) {
      if (!cameraTween.at) cameraTween.at = now;
      const t = Math.min(1, (now - cameraTween.at) / cameraTween.duration),
        v = V.ease(t);
      camera = {
        x: cameraTween.x + (cameraTween.tx - cameraTween.x) * v,
        y: cameraTween.y + (cameraTween.ty - cameraTween.y) * v
      };
      zoom = cameraTween.z * Math.pow(cameraTween.tz / cameraTween.z, v);
      applyCamera();
      if (t === 1) cameraTween = null;
    }
    if (playing && !calculating && lastFrame) {
      try {
        const result = simulationClock.runAsync((now - lastFrame) / 1000, speed, perf.budget, (dt,options) => M.advanceBudgetAsync(
          s, traffic, dt,options), () => performance.now());
        computeMs = computeMs * .8 + result.ms * .2;
        if (!result.ok) {
          setPlaying(false);
          toast('余额不足或贷款到期未偿还，运营已暂停。');
        }
      } catch (error) {
        runtimeFault = error.message;
        setPlaying(false);
        toast('运营计算异常，已暂停并保留上次存档。请查看管理 → 运行诊断。');
      }
    }
    if (playing && now - lastDots >= 1000 / (lodLevel === 'full' ? perf.fps : Math.min(perf.fps, 12))) {
      const at = performance.now();
      renderDots();
      paintMs = paintMs * .8 + (performance.now() - at) * .2;
      lastDots = now;
    }
    if (now - lastSave > 10000) {
      save();
      lastSave = now;
    }
    lastFrame = now;
    if (now - lastHUD > perf.hud) {
      updateHUD();
      lastHUD = now;
    }
    if (now - lastPerf > 1500) {
      document.dispatchEvent(new CustomEvent('rail-performance', {
        detail: {
          mode: perf.name,
          fps: lodLevel === 'full' ? perf.fps : Math.min(perf.fps, 12),
          drawn: drawnTrainMarkers,
          detail: DETAIL.LABELS[lodLevel] || '完整显示',
          compute: computeMs,
          paint: paintMs,
          trains: traffic.trains.length,
          stations: new Set(s.services.flatMap(l => l.stops)).size,
          pending: simulationClock.pending
        }
      }));
      lastPerf = now;
    }
    requestAnimationFrame(frame);
  }

  function resetCamera() {
    clearTimeout(focusTimer);
    const f = region === 'gba' ? display(B.project(22.95, 113.55, region)) : cfg.focus;
    flyTo(f.x, f.y, region === 'gba' ? 2.3 : innerWidth < 650 ? 12 : 8, 540);
  }
  let centerWorker = null,
    centerJob = null,
    centerJobId = 0,
    centerForecastSent = null,
    centerVersion = 0,
    lastCenterWall = -Infinity,
    centerRendered = null,
    centerError = '';

  function releaseCenterWorker() {
    if (centerJob) clearTimeout(centerJob.timer);
    centerJob = null;
    if (centerWorker) {
      centerWorker.onmessage = centerWorker.onerror = null;
      centerWorker.terminate();
      centerWorker = null;
    }
    centerForecastSent = null;
  }

  function centerRows(force = false) {
    const now = performance.now(),
      stale = !centerAnalysis || centerAnalysis.state !== s || centerAnalysis.forecast !== forecast;
    if (!centerJob && (force || stale && !centerError || now - lastCenterWall >= 10000)) requestCenter();
    return centerAnalysis?.state === s && centerAnalysis.forecast === forecast ? centerAnalysis.rows : [];
  }

  function requestCenter() {
    const id = ++centerJobId,
      state = s,
      prediction = forecast,
      revision = networkRevision,
      atMinute = traffic.minute;
    centerJob = {
      id,
      state,
      prediction,
      revision
    };
    lastCenterWall = performance.now();
    centerError = '';

    function fail(message) {
      if (centerJob?.id !== id) return;
      clearTimeout(centerJob.timer);
      centerJob = null;
      centerError = message;
      centerForecastSent = null;
      if (centerWorker) {
        centerWorker.terminate();
        centerWorker = null;
      }
      if (overview) renderOverview(false, true);
    }
    try {
      if (!centerWorker) {
        centerWorker = new Worker('operations-worker.js?v=56');
        centerForecastSent = null;
      }
      centerWorker.onerror = e => fail(e.message || '后台诊断不可用');
      centerWorker.onmessage = ({
        data: m
      }) => {
        if (centerJob?.id !== m.id) return;
        clearTimeout(centerJob.timer);
        if (m.error) {
          fail(m.error);
          return;
        }
        centerJob = null;
        if (state !== s || prediction !== forecast || revision !== networkRevision) {
          if (overview) requestCenter();
          return;
        }
        centerAnalysis = {
          state,
          forecast: prediction,
          minute: atMinute,
          rows: m.rows,
          metrics: m.metrics,
          ms: m.ms
        };
        if (overview && !utilityPanel && !centerReview && !document.activeElement?.matches(
            '#overview-panel input,#overview-panel select')) renderOverview(true);
      };
      const snapshot = RailDiagnosticSnapshot.capture(s, traffic);
      const slim = snapshot.state;
      const runtime = snapshot.runtime;
      const changed = centerForecastSent !== forecast;
      if (changed) centerVersion++;
      centerWorker.postMessage({
        id,
        version: centerVersion,
        state: slim,
        runtime,
        ...(changed ? {
          forecast: {
            flows: forecast.flows,
            population: forecast.population,
            catchment: {
              covered: forecast.catchment?.covered || 0
            }
          }
        } : {})
      });
      centerForecastSent = forecast;
      centerJob.timer = setTimeout(() => fail('后台诊断超时，请重试；列车和乘客继续运行。'), 45000);
    } catch (e) {
      fail(e.message);
    }
  }

  function patchCenterPanel(panel, markup) {
    const fresh = document.createElement('div');
    fresh.innerHTML = markup;
    const oldList = panel.querySelector('.center-lines'),
      newList = fresh.querySelector('.center-lines');
    if (!oldList || !newList) {
      panel.innerHTML = markup;
      return;
    }
    DOM.reconcile(oldList, [...newList.children], 'data-center-row');
    let index = 0;
    patchInsightNode(panel.querySelector('.panel-header'), fresh.querySelector('.panel-header'));
    const scroll = panel.querySelector('.panel-scroll'),
      next = fresh.querySelector('.panel-scroll'),
      keep = new Set();
    index = 0;
    for (const child of [...next.children]) {
      let el;
      if (child === newList) el = oldList;
      else {
        el = [...scroll.children].find(x => x !== oldList && (child.id ? x.id === child.id : x
          .className === child.className && x.tagName === child.tagName));
        if (el) patchInsightNode(el, child);
        else el = child;
      }
      keep.add(el);
      const at = scroll.children[index++];
      if (at !== el) scroll.insertBefore(el, at || null);
    }
    for (const el of [...scroll.children])
      if (!keep.has(el)) el.remove();
  }

  function centerMatch(row) {
    return centerView.match(row, centerFilter, centerQuery);
  }

  function filterCenter() {
    const rows = centerRows();
    for (const el of document.querySelectorAll('[data-center-row]')) {
      const row = rows.find(x => x.id === el.dataset.centerRow);
      el.hidden = !row || !centerMatch(row);
    }
    const shown = rows.filter(centerMatch).length;
    if ($('center-empty')) $('center-empty').hidden = shown > 0;
    if ($('center-result-count')) $('center-result-count').textContent = shown + ' / ' + rows.length +
      ' 条';
  }

  function centerEvidence(row) {
    return centerView.evidence(s, row);
  }
  document.addEventListener('toggle', e => {
    const el = e.target;
    if (!overview || !el.matches?.('details[data-center-detail]') || !el.open) return;
    const row = centerAnalysis?.rows.find(r => r.id === el.dataset.centerDetail),
      body = el.querySelector('[data-center-evidence]');
    if (row && body && !body.hasChildNodes()) body.innerHTML = centerEvidence(row);
  }, true);

  function renderOverview(ready = false, noRequest = false) {
    if (!overview || utilityPanel) return;
    centerRendered = centerAnalysis;
    const panel = $('overview-panel'),
      scroll = panel.querySelector('.panel-scroll')?.scrollTop || 0,
      open = new Set([...panel.querySelectorAll('details[open]')].map(x => x.dataset.centerDetail || x
        .id)),
      rows = [...(ready || noRequest ? centerAnalysis?.rows || [] : centerRows())],
      m = centerAnalysis?.metrics || {
        lines: s.services.length,
        stations: new Set(s.services.flatMap(l => l.stops)).size,
        networkKm: 0,
        lineKm: 0,
        journeys: 0,
        intensity: 0,
        passengerKm: 0,
        averageDistance: 0,
        interchanges: 0,
        transferShare: 0,
        coverage: 0
      },
      counts = {
        add: rows.filter(x => x.suggestions.some(a => ['add', 'stock', 'crowd'].includes(a.type))).length,
        reduce: rows.filter(x => x.suggestions.some(a => a.type === 'reduce')).length,
        pattern: rows.filter(x => x.suggestions.some(a => a.action === 'pattern' || ['short', 'express']
          .includes(a.type))).length,
        attention: rows.filter(x => x.priority >= 60).length
      };
    if (sort === 'riders') rows.sort((a, b) => b.stats.riders - a.stats.riders);
    if (sort === 'capacity') rows.sort((a, b) => b.priority - a.priority);
    patchCenterPanel(panel, centerView.content({
      state: s,
      minute: traffic.minute,
      rows,
      metrics: m,
      counts,
      sort,
      query: centerQuery,
      filter: centerFilter,
      error: centerError,
      expanded: open,
      review: centerReview,
      pulse: reviewPulse()
    }));

    for (const d of panel.querySelectorAll('details'))
      if (open.has(d.dataset.centerDetail || d.id)) d.open = true;
    panel.querySelector('.panel-scroll').scrollTop = scroll;
  }
  async function centerApply() {
    if (!centerReview || calculating) return;
    const row = centerRows().find(x => x.id === centerReview.id),
      p = centerReview.preview,
      live = s.services.find(l => l.id === centerReview.id);
    if (!row || !live || p.error || OC.signature(live) !== p.signature || OC.preview(s, row).error) {
      centerReview = null;
      renderOverview();
      toast('线路计划已变化，请重新审核方案。');
      return;
    }
    const result = await commit(c => N.configure(c, row.id, p.values), '投放计划已更新，现有乘客与运行列车保留。');
    if (result) {
      centerReview = null;
      renderOverview();
    }
  }

  function prepareCenterPattern(id, key) {
    const row = centerRows().find(x => x.id === id),
      advice = row?.suggestions.find(x => x.key === key);
    if (!advice?.patterns) return;
    selectLine(id);
    showLineTab('rules');
    $('pattern-list').innerHTML = advice.patterns.map((p, i) => patternCard({
      ...current(),
      patterns: advice.patterns
    }, p, i).replace('当前 ', '草案 ')).join('');
    const note = document.createElement('p');
    note.className = 'dispatch-pending';
    note.textContent = '运营中心草案 · ' + advice.title + '。尚未生效，请检查端点、停站、配额后点击“应用运营规则”。';
    $('pattern-list').before(note);
    $('pattern-list').scrollIntoView({
      block: 'start',
      behavior: 'smooth'
    });
    dispatchDirty = true;
    toast('交路草案已填入编辑器，尚未生效。');
  }

  let reviewLine = '',
    reviewFilter = 'all';

  function reviewContent() {
    return reviewView.content(s, reviewLine, reviewFilter);
  }

  function reviewPulse() {
    return reviewView.pulse(s);
  }

  let stationForecastCache = null;

  function stationForecast(id) {
    const hour = Math.floor(traffic.minute / 60);
    if (!stationForecastCache || stationForecastCache.forecast !== forecast || stationForecastCache
      .hour !== hour) {
      const entries = {};
      for (const f of forecast.flows) {
        const n = f.trips * Q.factor(s, f);
        for (const [station, key] of [
            [f.from, 'entry'],
            [f.to, 'exit']
          ]) {
          const st = entries[station] || (entries[station] = {
            entry: 0,
            exit: 0
          });
          st[key] += n;
        }
      }
      stationForecastCache = {
        forecast,
        hour,
        entries
      };
    }
    return stationForecastCache.entries[id] || {
      entry: 0,
      exit: 0
    };
  }

  function capacityNote(id) {
    const r = Q.limits(s, id);
    return `模型站型：${r.platforms} 个站台候车面，站台长 ${r.length} m，可用宽 ${r.usableWidth} m；按 ${r.spacePerPerson} m²/人计算。站满后限流，站外等候最多15分钟；超限改用其他方式。面积为游戏估计，非本站实测。`;
  }

  function memoryDiagnostics() {
    const native=RailRouting.status(),runtime=native.worker||native;
    const latest = memoryAudit.latest(),
      queue = saveQueue.stats(),
      cache = forecast.diagnostics?.memory;
    const mb = value => value === null || value === undefined ? '未提供' : (value / 1024 / 1024).toFixed(1) +
      ' MB';
    return `<details id="memory-details" class="console-details" ${$('memory-details')?.open?'open':''}><summary>内存与后台任务</summary><div class="detail-row"><span>寻路核心</span><b>Rust / WASM · 需求、列车、队列、统计与经营核</b></div><p class="station-note">堆内存为当前页面JS估计，Worker、图片与浏览器总内存需结合浏览器任务管理器；采样最多保留48条。</p><div class="detail-row"><span>运行状态</span><b>${traffic.nativeView?'Rust 持有明细 · 前端摘要':'兼容视图'}</b></div><div class="detail-row"><span>模拟执行位置</span><b>${native.worker?'独立 Worker · Rust/WASM':'主线程 · Rust/WASM'}</b></div><div class="detail-row"><span>融合事务 / Rust 循环步数</span><b>${runtime.cycleCalls||0} / ${runtime.loopSteps||0}</b></div><div class="detail-row"><span>运动回传减少</span><b>${runtime.projectionFullValues?(100*(1-runtime.projectionSentValues/runtime.projectionFullValues)).toFixed(1)+'%':'—'}</b></div><div class="detail-row"><span>原生保留的到达明细</span><b>${(runtime.arrivalValuesOmitted||0)/2} 条</b></div><div class="detail-row"><span>模拟传入 / 传出累计</span><b>${mb(runtime.transport?.inputBytes)} / ${mb(runtime.transport?.outputBytes)}</b></div><div class="detail-row"><span>主线程 / 模拟 Worker WASM</span><b>${mb(native.mainMemoryBytes)} / ${mb(native.workerMemoryBytes)}</b></div><div class="detail-row"><span>运行分配内核调用</span><b>${runtime.simulationCalls||0} 次</b></div><div class="detail-row"><span>原生统计批次 / 单独调用</span><b>${runtime.statisticsBatches||0} / ${runtime.statisticsCalls||0}</b></div><div class="detail-row"><span>准备批次 / 覆盖缓存复用</span><b>${runtime.preparationCalls||0} / ${runtime.coverageCacheHits||0}</b></div><div class="detail-row"><span>运行结算步数</span><b>${runtime.engineSteps||0} 次 · ABI ${runtime.engineAbi||0}</b></div><div class="detail-row"><span>反馈与经营时钟调用</span><b>${runtime.operationsCalls||0} 次 · ABI ${runtime.operationsAbi||0}</b></div><div class="detail-row"><span>独立时序 / 原生到达批次</span><b>${runtime.temporalCalls||0} / ${runtime.timedArrivalCalls||0} · ABI ${runtime.temporalAbi||0}</b></div><div class="detail-row"><span>运行线程WASM / 峰值</span><b>${mb(runtime.memoryBytes)} / ${mb(runtime.peakMemoryBytes)}</b></div><div class="detail-row"><span>运行线程状态保护</span><b>${runtime.runtimePinned?'活跃状态保留':mb(runtime.recycleLimitBytes)}</b></div><div class="detail-row"><span>页面JS堆 / 采样峰值</span><b>${mb(latest?.heap)} / ${mb(latest?.peak)}</b></div><div class="detail-row"><span>预测路径 / 实际使用出行组合</span><b>${forecast.flows.length} / ${traffic.defs.length}</b></div><div class="detail-row"><span>保存编码 / 待保存</span><b>${queue.active?1:0} / ${queue.pending?1:0}</b></div><div class="detail-row"><span>已合并保存请求</span><b>${queue.coalesced}</b></div>${cache?`<div class="detail-row"><span>整段预测调用</span><b>${cache.wasm?.forecastCalls||0} 次</b></div><div class="detail-row"><span>需求线程WASM线性内存</span><b>${mb(cache.wasm?.memoryBytes)}</b></div><div class="detail-row"><span>寻路树组缓存峰值 / 预算</span><b>${cache.routeTrees.peak} / ${cache.routeTrees.limit}</b></div><div class="detail-row"><span>路线策略缓存峰值 / 预算</span><b>${cache.strategies.peak} / ${cache.strategies.limit}</b></div>`:''}</details>`;
  }

  function diagnosticContent() {
    const d = O.demandSummary(traffic),
      minute = ((traffic.minute % 1440) + 1440) % 1440,
      open = s.services.filter(l => RailOperations.isOpen(l, traffic.minute)),
      available = open.filter(l => F.planned(l, traffic.minute) > 0),
      nextOpening = s.services.map(l => ({
        ...l,
        wait: Math.ceil((l.open - minute + 1440) % 1440)
      })).sort((a, b) => a.wait - b.wait)[0],
      label = runtimeFault ? '运营计算异常' : demandState.status === 'error' ? '需求更新失败' : !playing ? '游戏已暂停' : !
      s.services.length ? '尚未建设线路' : !open.length ? '非运营时段' : !available.length ? '运营线路未投放列车' : !d
      .activeProfiles ? '暂无可达出行需求' : demandState.status === 'updating' ? '后台更新中' : '客流模型运行中';
    return memoryDiagnostics() +
      `<div class="record-hero"><span>浏览器本机模拟 · ${demandClient.active?'Worker 后台计算':'主线程备用计算'}</span><strong style="font-size:24px">${label}</strong><div>第 ${Q.day(traffic.minute)} 天 · ${clock(traffic.minute)}</div></div>${!open.length&&s.services.length?`<p class="metrics-notice">当前没有线路处于运营时段。最近开行：${esc(nextOpening.name)} · ${clock(nextOpening.open)}（${nextOpening.wait} 游戏分钟后）${traffic.trains.length?'；末班列车仍在完成本次运行。':'；收班后列车、候车和车上人数归零属于正常情况。'}</p>`:''}${runtimeFault||demandState.error?`<p class="save-error">${esc(runtimeFault||demandState.error)}</p>`:''}<div class="section-title">需求与运行</div>${[['预测出行组合（非人数）',num(d.profiles)],['有需求的出行组合',num(d.activeProfiles)],['基础日需求',num(d.daily)+' 人次 / 日'],['已实际使用的出行组合',num(d.storedProfiles)],['运营时段内线路',open.length+' / '+s.services.length],['已投放车辆的运营线路',available.length],['在线列车',traffic.trains.length],['本局累计尝试出行',num(traffic.generated)],['本局累计上车（含换乘）',num(traffic.boarded)],['本局累计完成出行',num(traffic.completed)],['此刻候车 / 车上',num(O.summary(traffic).waiting)+' / '+num(O.summary(traffic).onboard)],['最近预测更新（非乘客刷新）',demandState.updatedAt===null?'—':clock(demandState.updatedAt)]].map(([k,v])=>`<div class="detail-row"><span>${k}</span><b>${v}</b></div>`).join('')}<div class="section-title">分线运营时间</div>${s.services.map(l=>`<button data-line="${esc(l.id)}" class="detail-row insight-link"><span>${esc(l.name)} · ${clock(l.open)}—${l.close===1440?'24:00':clock(l.close)}</span><b>${RailOperations.isOpen(l,traffic.minute)?F.planned(l,traffic.minute)>0?'运营中':'未投放列车':'已收班 / 未开行'}</b></button>`).join('')}<button id="retry-demand" class="insight-link">重新计算客流</button><p class="station-note">客流在本机浏览器计算，没有独立客流服务器。非运营时段、停运或暂停时，候车与车上人数可能正常归零；游戏日07:00切换，今日累计会重置。需求档案采用按实际到达创建的方式保存，不因预测超过6万条清零。重算失败会保留上次需求；已受旧版错误影响的存档刷新后会重新接入当前需求，历史缺失数据不补造。运营计算若抛出异常会暂停，避免自动覆盖上次成功存档。</p>`;
  }

  function dailyContent() {
    const d = INS.daily(s, traffic);
    return `<div class="insight-eyebrow">第 ${d.day} 个运营日 · ${clock(traffic.minute)}</div><div class="daily-hero"><span>今日完成出行</span><strong>${num(d.completed)}<small> 人次</small></strong><div><span>实际票款 <b>${money(d.revenue)}</b></span><span>客运周转量 <b>${num(d.passengerKm)} 人公里</b></span></div></div><div class="daily-summary"><span>线网 <b>${d.networkKm.toFixed(1)} km</b></span><span>今日运营结余 <b class="${d.profit<0?'negative':''}">${money(d.profit)}</b></span></div><div class="insight-heading"><h3>分线客流排行</h3><span>今日乘车人次 ↓</span></div><p class="station-note">全网客流为已完成的完整出行，不重复计算换乘；分线客流为本线上车人次，含换乘。负载率为此刻在线列车总人数 / 总定员，未开行时显示—；客流强度为今日上车人次 / 线路公里，截至当前时刻。</p>${d.partial?`<div class="metrics-notice">收支与人公里明细自本运营日 ${clock(d.metricsSince??traffic.minute)} 起记录</div>`:''}<div class="daily-lines">${d.rows.map((r,i)=>`<article class="daily-line" data-daily-line="${r.id}" style="--line:${esc(r.color)}"><header><span class="daily-rank">${i+1}</span><button data-line="${r.id}">${esc(r.name)} <small>↗</small></button><b>${num(r.riders)}<small> 人次</small></b></header><div class="daily-line-grid"><div><span>实时负载率</span><b>${r.load===null?'—':(r.load*100).toFixed(1)+'%'}</b></div><div><span>今日客流强度</span><b>${num(r.intensity)}<small> 人次/km</small></b></div><div><span>今日客运周转量</span><b>${num(r.passengerKm)}<small> 人公里</small></b></div><div><span>线路里程 / 在线</span><b>${r.km.toFixed(1)}<small> km · ${r.trains} 列</small></b></div></div><div class="daily-money"><span>票款 <b>${money(r.revenue)}</b></span><span>发展金 <b>${money(r.grant)}</b></span><span>运营支出 <b>${money(r.operating)}</b></span><span>运营结余 <b class="${r.profit<0?'negative':''}">${money(r.profit)}</b></span></div></article>`).join('')||'<div class="insight-empty">还没有线路<br><small>建成线路并投放列车后，这里会显示今日运营表现。</small></div>'}</div><p class="finance-note">票款为完成旅程后按线路分成的实际收入，发展金单独列示；运营结余＝票款＋发展金−运营支出，不扣建设投资、贷款本息。车辆运行成本按实际线路记录，共同维护、设施与车库固定成本按线路公里分摊，作为经营参考。删除线路的既有收支仍留在全网合计中，可能不等于当前线路卡片之和。</p><div class="insight-actions"><button id="records-open">线网客流</button><button id="achievements-open">成就 →</button></div>`;
  }

  function achievementContent() {
    const all = Q.awards(personalRecords),
      done = all.filter(a => a.unlocked).length,
      items = all.filter(a => achievementFilter === '全部' || achievementFilter === '未达成' && !a.unlocked ||
        a.category === achievementFilter),
      format = v => v >= 10000 ? (v / 10000).toLocaleString('zh-CN', {
        maximumFractionDigits: 1
      }) + '万' : v.toLocaleString('zh-CN', {
        maximumFractionDigits: 1
      });
    return `<div class="achievement-hero"><span>本地图 · 个人里程碑</span><strong>${done}<small> / ${all.length}</small></strong><div class="achievement-overall"><i style="width:${done/all.length*100}%"></i></div><p>已达成</p></div><div class="achievement-filters">${['全部','客流','运输','线网','收入','未达成'].map(c=>`<button data-achievement-filter="${c}" class="${achievementFilter===c?'active':''}">${c}</button>`).join('')}</div><div class="milestone-grid">${items.map(a=>`<article data-milestone="${a.id}" class="milestone ${a.unlocked?'unlocked':''}"><header><i>${a.unlocked?'✦':'◇'}</i><span>${a.category}</span><b>${a.unlocked?'已达成':Math.floor(a.progress*100)+'%'}</b></header><h3>${a.name}</h3><p>${a.unit} ${format(a.displayTarget)} ${a.suffix}</p><div class="milestone-track"><i style="width:${a.progress*100}%"></i></div><footer>${format(Math.min(a.displayValue,a.displayTarget))} / ${format(a.displayTarget)} ${a.suffix}</footer></article>`).join('')||'<div class="insight-empty">这一分类已全部达成</div>'}</div><p class="station-note">成就按本地图历史最高纪录解锁，开始新游戏不会清除。客流、周转量与票款使用单局累计最高；线网按物理轨道去重，单线按线路实际路径。客运周转量按真实乘车人数×行驶公里累计，旧存档从升级后开始；收入仅计实际票款，不计发展金、借款或资产回收。既有客流成就及纪录保留。</p><div class="insight-actions"><button id="daily-open">今日客流</button><button id="records-open">线网客流</button></div>`;
  }

  function recordMini() {
    const r = personalRecords;
    return `<div class="record-mini"><span>单日最高<b>${num(r.bestDay||0)}</b></span><span>连续60分钟最高<b>${num(r.bestHour||0)}</b></span><button id="records-open">线网客流 →</button></div>`;
  }

  function legacyRecordDetails() {
    const q = s.ridership,
      r = personalRecords,
      days = [...(q?.history || []), q?.current].filter(Boolean).slice(-14),
      max = Math.max(1, ...days.map(d => d.completed)),
      awards = Q.awards(r);
    return `<div class="record-hero"><span>个人最高 · 实际完成出行</span><strong>${num(r.bestDay||0)}<small> 人次 / 游戏日</small></strong><div>连续60分钟最高 <b>${num(r.bestHour||0)}</b> 人次</div></div><div class="section-title">本局运营</div><div class="stat-grid"><div><span>今天完成出行</span><strong data-today-completed>${num(q?.current.completed||0)}</strong></div><div><span>今天站满 / 超时退出</span><strong>${num(q?.current.rejected||0)}</strong></div></div><div class="section-title">近 ${days.length} 个运营日</div><div class="ridership-history" role="img" aria-label="最近运营日实际完成出行趋势">${days.map((d,i)=>`<div title="第${d.number}天 · ${num(d.completed)}人次"><b>${days.length<=7||i%3===0||i===days.length-1?num(d.completed):''}</b><i style="height:${Math.max(0,d.completed/max*90)}px"></i><small>${d.number}日</small></div>`).join('')}</div><button id="achievements-open" class="insight-link">查看全部成就 →</button><p class="station-note">只统计成功抵达的完整出行，换乘不重复；预测值、排队和放弃人数不能刷纪录。每游戏日07:00结算，当前日也可刷新最高纪录。本地图个人最高保存在本机，开始新游戏仍保留；旧版本没有逐日历史，从本版本开始记录。</p>`;
  }
  let flowDay = 'today',
    flowMetric = 'entered',
    flowInterval = 15,
    flowHovered = '';
  const flowNames = {
    entered: '进站',
    boarded: '上车',
    completed: '完成出行'
  };
  const flowTime = (minute, base) => ((Math.floor((minute + 1e-7) / 1440) > Math.floor(base / 1440)) ?
    '次日' : '') + clock(minute);

  function flowReadout(e) {
    const point = e.target.closest?.('[data-flow-label]');
    if (point && $('flow-readout')) {
      flowHovered = point.dataset.flowLabel;
      $('flow-readout').textContent = flowHovered;
    }
  }
  document.addEventListener('pointerover', flowReadout);
  document.addEventListener('focusin', flowReadout);

  function flowChart(v) {
    const w = 360,
      h = 218,
      left = 38,
      right = 348,
      top = 20,
      bottom = 178,
      max = Math.max(1, ...v.points.map(p => p.value || 0)),
      ceiling = Math.max(2, Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math
        .floor(Math.log10(max)))),
      x = m => left + (m - v.points[0].start) / 1440 * (right - left),
      y = n => bottom - n / ceiling * (bottom - top);
    let path = '',
      previous = false;
    for (const p of v.points) {
      if (p.value === null) {
        previous = false;
        continue;
      }
      path += (previous ? 'L' : 'M') + x((p.start + p.end) / 2).toFixed(2) + ' ' + y(p.value).toFixed(2) +
        ' ';
      previous = true;
    }
    const grid = [0, .5, 1].map(t =>
        `<g><line x1="${left}" x2="${right}" y1="${y(ceiling*t)}" y2="${y(ceiling*t)}"/><text x="${left-7}" y="${y(ceiling*t)+4}" text-anchor="end">${ceiling*t>=10000?(ceiling*t/10000).toFixed(1)+'万':Math.round(ceiling*t)}</text></g>`
      ).join(''),
      ticks = [0, 240, 480, 720, 960, 1200, 1440].map(m =>
        `<text x="${x(v.points[0].start+m)}" y="200" text-anchor="middle">${clock(v.points[0].start+m)}</text>`
      ).join('');
    const hits = v.points.filter(p => p.value !== null).map(p => {
      const cx = x((p.start + p.end) / 2),
        cy = y(p.value),
        label =
        `${flowTime(p.start,v.points[0].start)}—${flowTime(p.end,v.points[0].start)} · ${flowNames[flowMetric]} ${num(p.value)} 人次${p.partial?' · 部分时段':''}`;
      return `<g class="flow-point" tabindex="0" role="img" aria-label="${esc(label)}" data-flow-label="${esc(label)}"><title>${esc(label)}</title><line class="flow-crosshair" x1="${cx}" x2="${cx}" y1="${top}" y2="${bottom}"/><circle cx="${cx}" cy="${cy}" r="3"/><rect x="${x(p.start)}" y="${top}" width="${(right-left)*flowInterval/1440}" height="${bottom-top}" fill="transparent"/></g>`;
    }).join('');
    return `<svg class="flow-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${flowNames[flowMetric]}分时客流曲线，单位人次每${flowInterval}分钟"><g class="flow-grid">${grid}${ticks}</g>${path?`<path class="flow-curve" d="${path}"/>`:''}${hits}</svg>`;
  }

  function recordDetails() {
    const q = s.ridership,
      days = [...(q?.history || []), q?.current].filter(Boolean),
      d = flowDay === 'today' ? q.current : days.find(d => d.number === +flowDay) || q.current,
      v = RailFlowHistory.view(d, flowMetric, flowInterval),
      metric = flowNames[flowMetric],
      peak = v.peak;
    return `<div class="flow-controls"><label>运营日<select id="flow-day" aria-label="客流运营日"><option value="today"${flowDay==='today'?' selected':''}>今天 · 第 ${q.current.number} 天</option>${days.filter(d=>d!==q.current).reverse().map(d=>`<option value="${d.number}"${+flowDay===d.number?' selected':''}>第 ${d.number} 天${!d.flow?' · 无分时记录':''}</option>`).join('')}</select></label><label>指标<select id="flow-metric" aria-label="客流指标">${Object.entries(flowNames).map(([k,name])=>`<option value="${k}"${flowMetric===k?' selected':''}>${name}${k==='boarded'?' · 含换乘':''}</option>`).join('')}</select></label><label>时段<select id="flow-interval" aria-label="客流时间粒度">${[15,30,60].map(n=>`<option value="${n}"${flowInterval===n?' selected':''}>${n} 分钟</option>`).join('')}</select></label></div><div class="flow-live"><div class="flow-day-heading"><span>第 ${d.number} 天 · ${metric}客流</span><small>07:00 — 次日07:00</small></div><div class="flow-summary"><div><span>${v.partial?'已记录':'当日'}${metric}</span><strong>${v.available?num(v.total):'—'}<small> 人次</small></strong></div><div><span>最高${flowInterval}分钟${peak?.partial?' · 部分时段':''}</span><strong>${peak?num(peak.value):'—'}<small> 人次</small></strong></div></div><section class="flow-chart-card"><header><b>分时客流</b><span>人次 / ${flowInterval}分钟</span></header>${flowChart(v)}<output id="flow-readout">${esc(flowHovered|| (peak?`峰值时段 ${flowTime(peak.start,RailFlowHistory.start(d))}—${flowTime(peak.end,RailFlowHistory.start(d))}`:'暂无分时记录'))}</output></section>${!v.available?'<div class="metrics-notice">该运营日没有分时记录。升级后开始采集，历史曲线不补造。</div>':`<div class="flow-coverage">记录范围 ${flowTime(v.since,RailFlowHistory.start(d))}—${flowTime(v.through,RailFlowHistory.start(d))}${v.partial?' · 从本版本启用时起记录':''} · 空白为尚未记录时段</div>`}<p class="station-note">曲线统计真实事件发生时段，非累计曲线；进站不重复统计站内换乘，上车包含换乘，完成出行按抵达目的地计一次。每运营日07:00切换，保留最近30天及今天。鼠标悬停或键盘聚焦曲线可查看时段数值；尚未记录的时段留空。</p></div><div class="flow-records"><details class="flow-history-details"><summary>历史纪录与每日总量</summary>${legacyRecordDetails()}</details></div>`;
  }

  function demandAudit() {
    const d = forecast.diagnostics || {},
      expected = forecast.flows.reduce((v, f) => v + (f.demandTrips ?? f.trips) * Q.factor(s, f), 0);
    return `<details class="demand-audit"><summary>客流核算</summary><p id="audit-status">${playing?'正在运营':'已暂停 · 点击右上角开始运营'}</p><div class="detail-row"><span>有轨道路径的候选出行</span><b>${num(d.connectedDemand||0)} 人次/日</b></div><div class="detail-row"><span>满意度调整后的日需求</span><b>${num(expected)} 人次/日</b></div><div class="detail-row"><span>基础日客流预测</span><b>${num(forecast.riders)} 人次/日</b></div><div class="detail-row"><span>本局实际到站</span><b id="audit-generated">${num(traffic.generated)}</b></div><div class="detail-row"><span>本局累计上车 · 含换乘</span><b id="audit-boarded">${num(traffic.boarded)}</b></div><div class="detail-row"><span>本局完成出行</span><b id="audit-completed">${num(traffic.completed)}</b></div><p class="station-note">日预测与当前候车人数不同；到站后可能已经上车或抵达。实际运营使用整数乘客，小概率 OD 在全网累积后抽取，不逐条舍入。</p></details>`;
  }

  function geography() {
    if (region !== 'gba') return '';
    const water = basemap === 'schematic' ?
      `<path d="${RailGBA.estuary.map(([lon,lat],i)=>{const p=display(B.project(lat,lon,region));return `${i?'L':'M'}${p.x} ${p.y}`;}).join(' ')}Z" fill="#c9e3e9" stroke="#9bc8d2" stroke-width="2"/>` :
      '';
    return water + RailGBA.cities.map((c, i) => {
      const p = display(B.project(c.centres[0][1], c.centres[0][0], region));
      return `<g class="city-anchor" data-city-index="${i}" transform="translate(${p.x} ${p.y})"><circle r="3"/><text y="-10" text-anchor="middle">${c.name}</text></g>`;
    }).join('');
  }

  let detailQuery=null;
  function requestDetail() {
    const view=inspection;
    if(!traffic.nativeView||!view||!['station','train'].includes(view.type))return null;
    const key=view.type+':'+view.id;
    if(!detailQuery||detailQuery.key!==key||detailQuery.runtime!==traffic)detailQuery={key,runtime:traffic,pending:false,data:null,updated:-Infinity};
    const cache=detailQuery;
    if(!cache.pending&&performance.now()-cache.updated>=250) {
      cache.pending=true;const rt=traffic;
      O.detailsAsync(rt,view.type,view.id).then(data=>{
        if(traffic===rt&&detailQuery===cache){cache.data=data;cache.updated=performance.now();cache.pending=false;renderActivity();}
      }).catch(error=>{if(traffic===rt&&detailQuery===cache){cache.pending=false;cache.updated=performance.now();toast(error.message);}});
    }
    return cache.data;
  }
  function inspect(type, id) {
    utilityPanel = null;
    hoverPoint = null;
    stationMenu = false;
    inspection = {
      type,
      id
    };
    account = false;
    overview = false;
    selected = null;
    mode = null;
    draft = [];
    render();
    if (['development', 'urban'].includes(type)) {
      const sc = $('activity-panel').querySelector('.panel-scroll');
      if (sc) sc.scrollTop = 0;
    }
  }

  function htmlIfChanged(el, html) {
    DOM.html(el, html);
  }

  function localSaveContent() {
    return saveView.content({
      state: s,
      cfg,
      pendingImport,
      saveStatus,
      saveMeta,
      importError,
      region
    });
  }

  async function downloadLocalSave() {
    await M.whenIdle(traffic);
    syncRecords();
    const data = LS.pack(s, await O.snapshotAsync(traffic), {
        playing,
        speed,
        personalRecords
      }),
      url = URL.createObjectURL(new Blob([JSON.stringify(data)], {
        type: 'application/json'
      })),
      a = document.createElement('a');
    a.href = url;
    a.download = 'rail-' + region + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('存档已生成，请查看浏览器下载。');
  }
  async function readLocalSave(file) {
    if (!file) return;
    importError = '';
    pendingImport = null;
    try {
      if (file.size > LS.MAX_BYTES) throw Error('文件超过64MB。');
      const next = LS.parse(await file.text());
      if (!pendingImport) importResume = playing;
      pendingImport = next;
      setPlaying(false);
    } catch (error) {
      importError = error.message;
    }
    renderActivity();
  }

  function cancelLocalImport() {
    pendingImport = null;
    importError = '';
    setPlaying(importResume);
    renderActivity();
  }
  async function applyLocalSave() {
    if (!pendingImport || calculating) return;
    const c = pendingImport;
    calculating = true;
    await M.whenIdle(traffic);
    $('calculation-status').textContent = '正在校验并恢复存档…';
    $('calculation-status').hidden = false;
    try {
      const next = await calculate(c.state);
      if (c.runtime) {
        const rt = O.restore(c.state, next, c.runtime);
        if (!rt || Math.abs(rt.minute - c.state.economy.minute) > .01) throw Error(
          '列车或乘客运行数据校验失败，当前进度未改变。');
      }
      const target = B.get(c.region);
      let restoredRecords = Q.mergeRecords(c.personalRecords, c.region === region ? personalRecords :
        {});
      try {
        const previous = await DB.read(target.saveKey);
        if (previous?.text) restoredRecords = Q.mergeRecords(restoredRecords, LS.records(JSON.parse(
          previous.text).personalRecords));
      } catch {}
      const payload = {
        gameVersion: 7,
        state: c.state,
        runtime: c.runtime,
        signature: c.signature,
        speed: c.speed,
        playing: false,
        personalRecords: restoredRecords
      };
      try {
        await saveQueue.flush();
        await DB.write(target.saveKey, payload);
      } catch {
        throw Error('本地数据库写入失败，原进度未替换；请检查浏览器站点存储权限或磁盘空间。');
      }
      try {
        const old = JSON.parse(localStorage.getItem(target.recordsKey) || '{}');
        localStorage.setItem(target.recordsKey, JSON.stringify(Q.mergeRecords(LS.records(old), c
          .personalRecords)));
      } catch {}
      importing = true;
      const url = new URL(location.href);
      url.searchParams.set('map', c.region);
      url.searchParams.set('v', UI_VERSION);
      location.assign(url.href);
    } catch (error) {
      importError = error.message;
      calculating = false;
      $('calculation-status').hidden = true;
      renderActivity();
    }
  }

  function patchInsightNode(old, next) {
    DOM.patchNode(old, next);
  }

  function refreshInsight(body, type) {
    if (type === 'records') {
      const pane = $('activity-panel');
      if (pane.dataset.insightKey !== 'records') {
        pane.dataset.insightKey = 'records';
        return false;
      }
      if (insightPointer) return true;
      const next = document.createElement('div');
      next.innerHTML = body;
      for (const selector of ['.flow-controls', '.flow-live', '.flow-records']) {
        const a = pane.querySelector(selector),
          b = next.querySelector(selector);
        if (!a || !b) return false;
        const open = a.querySelector('details')?.open;
        patchInsightNode(a, b);
        if (open && a.querySelector('details')) a.querySelector('details').open = true;
      }
      return true;
    }
    const pane = $('activity-panel'),
      key = type + '|' + (type === 'achievements' ? achievementFilter : ''),
      oldKey = pane.dataset.insightKey;
    pane.dataset.insightKey = key;
    if (oldKey !== key) return false;
    if (insightPointer) return true;
    const next = document.createElement('div');
    next.innerHTML = body;
    const selectors = type === 'daily' ? ['.insight-eyebrow', '.daily-hero', '.daily-summary'] : [
      '.achievement-hero'
    ];
    for (const selector of selectors) {
      const a = pane.querySelector(selector),
        b = next.querySelector(selector);
      if (a && b) patchInsightNode(a, b);
    }
    const list = type === 'daily' ? '.daily-lines' : '.milestone-grid',
      attr = type === 'daily' ? 'data-daily-line' : 'data-milestone',
      old = pane.querySelector(list),
      fresh = next.querySelector(list);
    if (!old || !fresh) return false;
    DOM.reconcile(old, [...fresh.children], attr);
    const notice = pane.querySelector('.metrics-notice'),
      newNotice = next.querySelector('.metrics-notice');
    if (notice && newNotice) notice.textContent = newNotice.textContent;
    else if (notice) notice.remove();
    else if (newNotice) pane.querySelector('.daily-lines')?.before(newNotice);
    return true;
  }

  function refreshReview(body) {
    const pane = $('activity-panel'),
      old = pane.querySelector('.review-records');
    if (!old) return false;
    const fresh = document.createElement('div');
    fresh.innerHTML = body;
    const newList = fresh.querySelector('.review-records');
    if (!newList) return false;
    for (const selector of ['.review-hero', '.review-tools', '.review-filters']) {
      const a = pane.querySelector(selector),
        b = fresh.querySelector(selector);
      if (a && b) patchInsightNode(a, b);
    }
    DOM.reconcile(old, [...newList.children], 'data-review-id', {
      preserveDetails: true
    });
    return true;
  }
  let choosingLocalFile = false;
  document.addEventListener('cancel', e => {
    if (e.target.id === 'local-save-file') {
      choosingLocalFile = false;
      renderActivity();
    }
  }, true);
  let urbanPanelKey = '',
    reviewPanelKey = '';

  function renderActivity() {
    if (inspection?.type === 'reviews') {
      const key = (s.operationsReview?.revision || 0) + '|' + reviewLine + '|' + reviewFilter;
      if (reviewPanelKey === key && $('activity-panel').dataset.reviewKey === key) return;
      reviewPanelKey = key;
      $('activity-panel').dataset.reviewKey = key;
    } else delete $('activity-panel').dataset.reviewKey;
    if (inspection && ['urban', 'development'].includes(inspection.type)) {
      const key = inspection.type + '|' + inspection.id + '|' + urbanTab + '|' + s.urban.revision + '|' +
        networkRevision + '|' + s.services.map(l => l.id + ':' + l.name + ':' + l.stops.join(',') + ':' +
          JSON.stringify(l.dispatch)).join(';');
      if (urbanPanelKey === key && $('activity-panel').dataset.cityKey === key) return;
      urbanPanelKey = key;
      $('activity-panel').dataset.cityKey = key;
    } else delete $('activity-panel').dataset.cityKey;
    if (!inspection || choosingLocalFile || (inspection.type === 'records' && document.activeElement
        ?.matches('#activity-panel select') || document.activeElement?.id === 'station-name' || inspection
        .type === 'depot' && document.activeElement?.matches('input,select'))) return;
    const nativeDetail=requestDetail();
    let title = '',
      body = '';
    if (inspection.type === 'reviews') {
      title = '调整效果';
      body = reviewContent();
    } else if (inspection.type === 'diagnostics') {
      title = '运行诊断';
      body = diagnosticContent();
    } else if (inspection.type === 'daily') {
      title = '今日客流与线路运营';
      body = dailyContent();
    } else if (inspection.type === 'achievements') {
      title = '成就';
      body = achievementContent();
    } else if (inspection.type === 'saves') {
      title = '本地存档';
      body = localSaveContent();
    } else if (inspection.type === 'urban') {
      title = '城市规划建设总览';
      body = urbanContent();
    } else if (inspection.type === 'development') {
      title = '发展片区';
      body = developmentContent(inspection.id);
    } else if (inspection.type === 'facility') {
      const f = s.urban.facilities.find(f => f.id === inspection.id);
      title = f ? U.TYPES[f.kind].name + ' · Lv.' + f.level : '设施已拆除';
      body = f ? facilityContent(f) : '<button id="back-to-urban">返回城市规划</button>';
    } else if (inspection.type === 'depot') {
      title = '列车库';
      body = depotContent();
    } else if (inspection.type === 'alarms') {
      title = '客流报警';
      body = alarmContent();
    } else if (inspection.type === 'records') {
      title = '线网客流';
      body = recordDetails();
    } else if (inspection.type === 'hubs') {
      title = '城际交通枢纽';
      body = hubList();
    } else if (inspection.type === 'hub') {
      const h = HubList.find(h => h.id === inspection.id);
      title = h.name;
      body = hubDetails(h);
    } else if (inspection.type === 'train') {
      const t = traffic.trains.find(t => t.id === inspection.id);
      if (!t) {
        title = '列车已完成本次运行';
        body = '<p>本班列车已抵达终点并退出运营。</p>';
      } else {
        const l = trainLine(t),
          dest = {};
        for (const [token, n] of Object.entries(nativeDetail||t.passengers)) {
          const j = traffic.defs[+token.split(':')[0]];
          if (j) dest[j.to] = (dest[j.to] || 0) + n;
        }
        title = runName(t.service) + ' · ' + t.id + (t.loop ? ' · ' + X.directionName(s, l, t.dir) : '');
        body =
          `<div class="big-load" style="--crowd:${crowd(t.onboard/t.capacity)}"><strong>${Math.round(t.onboard/t.capacity*100)}%</strong><span>满载率 · ${num(t.onboard)} / ${t.capacity} 人</span></div><p>${l.stockSpec||l.cars+' 辆编组'} · ${t.status==='moving'?'行驶中':t.status==='signal'?'信号等待':'停站中'}</p><p>${esc(s.nodes[t.stops[t.index]].name)} → ${esc(s.nodes[t.stops[Math.min(t.stops.length-1,Math.max(0,t.index+t.dir))]].name)}</p><div class="section-title">车上乘客目的地</div>${Object.entries(dest).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([id,n])=>`<div class="detail-row"><span>${esc(s.nodes[id].name)}</span><b>${num(n)} 人</b></div>`).join('')||'<p>暂无乘客</p>'}<button data-line="${l.id}">查看线路</button>`;
      }
    } else {
      const n = inspection.type === 'station' ? s.nodes[inspection.id] : inspection.id,
        local = C.local(n, .8, region, s),
        st = inspection.type === 'station' ? (nativeDetail||O.station(traffic, n.id)) : null,
        assigned = forecast.catchment.stations[n.id];
      title = st ? n.name : '密度与开发详情';
      body =
        `${st?'':densitySummary(n)}${urbanArea(n)}${st?`<button id="back-to-line" class="back-to-line">← 返回线路详情</button><div class="identity-form"><label for="station-name">车站名称</label><input id="station-name" maxlength="40" value="${esc(n.name)}"><button id="save-station-name">保存站名</button></div><div class="big-load" data-inside="${st.waiting}" data-capacity="${st.capacity}"><strong>${num(st.waiting)}<small> / ${num(st.capacity)}</small></strong><span>此刻站内候车 · 含换乘 · 容量上限</span></div><div class="queue-capacity-track"><i style="width:${Math.min(100,st.waiting/st.capacity*100)}%"></i></div><div class="detail-row"><span>站外等候 / 上限</span><b>${num(st.outside)} / ${num(st.outsideCapacity)} 人</b></div><div class="section-title">今日累计 · 实际人次</div><div class="stat-grid"><div><span>进站 · 不含换乘</span><strong>${num(st.today.entered)}</strong></div><div><span>上车 · 含换乘</span><strong>${num(st.today.boarded)}</strong></div><div><span>下车 · 含换乘</span><strong>${num(st.today.alighted)}</strong></div><div><span>全日进站预测</span><strong>${num(stationForecast(n.id).entry)}</strong></div></div><p class="station-note">候车是此刻还没上车的人数，累计客流按整个游戏日统计；每日07:00重置。全日预测已计入当前满意度。</p><p class="station-note">${capacityNote(n.id)}</p><div class="section-title">各线路候车人数</div><p class="transfer-status">站内换乘中 ${num(st.transferring||0)} 人 · 步行 ${X.TRANSFER} 分钟后进入下一站台</p>${Object.entries(st.lines).map(([id,count])=>`<div class="detail-row"><button data-line="${id}">${esc(runName(id))}</button><b>${num(count)} 人</b></div>`).join('')||'<p>当前没有候车乘客</p>'}<div class="purpose-chips"><span>通勤 ${num(st.purposes.work)}</span><span>购物 ${num(st.purposes.shopping)}</span><span>休闲 ${num(st.purposes.leisure)}</span></div><div class="section-title">候车乘客目的地</div>${Object.entries(st.destinations).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,count])=>`<div class="detail-row"><span>${esc(s.nodes[id].name)}</span><b>${num(count)} 人</b></div>`).join('')}`:''}<div class="section-title">步行 800 m 范围 · 当前城市</div><div class="detail-row"><span>城市生长人口 · 模拟</span><b>${num(local.people)} 人</b></div><div class="detail-row"><span>岗位 · 模型</span><b>${num(local.jobs)} 个</b></div><div class="detail-row"><span>商业机会 · 模型</span><b>${num(local.shops)}</b></div><div class="detail-row"><span>工业开发面积 · 模拟</span><b>${(region==='gba'||local.surveyArea>0)?local.factory.toFixed(3)+' km²':'无覆盖数据'}</b></div><div class="detail-row"><span>工业岗位 · 模型</span><b>${num(local.industry)}</b></div>${assigned?`<div class="detail-row"><span>本站分配居民</span><b>${num(assigned.people)} 人</b></div><div class="detail-row"><span>平均步行距离</span><b>${Math.round(assigned.walk*1000)} m</b></div>`:''}<p class="station-note">按街区居民与目的地生成出行，步行距离含 1.25 倍绕行系数。重叠范围按接驳方式和时间分摊到可选车站，避免重复计算；区域总量与本站分配量不同。人口与岗位从零开始，随车站、市政服务和市场成熟逐步增长；现实底图只用于地理和开发约束。</p>${st?`<button data-locate="${n.id}">定位本站</button>`:''}`;
    }
    if (inspection.type === 'reviews' && refreshReview(body)) return;
    if (['daily', 'achievements', 'records'].includes(inspection.type)) {
      if (refreshInsight(body, inspection.type)) return;
    } else delete $('activity-panel').dataset.insightKey;
    const scroll = $('activity-panel').querySelector('.panel-scroll')?.scrollTop || 0;
    const markup = `<div class="panel-header"><div class="panel-heading"><h2>${esc(title)}</h2><button id="close-activity" class="panel-close" aria-label="关闭客流详情">×</button></div></div><div class="panel-scroll activity-scroll">${body}</div>`;
    if (inspection.type === 'diagnostics') {
      DOM.patchMarkup($('activity-panel'), markup, { preserveDetails: true, preserveForms: true });
    } else htmlIfChanged($('activity-panel'), markup);
    $('activity-panel').querySelector('.panel-scroll').scrollTop = scroll;
  }

  function renderAccount() {
    if (!account) return;
    const panel = $('account-panel');
    DOM.patchMarkup(panel, financeView.content(s, N.allStats(s, forecast), M.available(s)), {
      preserveDetails: true,
      preserveForms: true,
      skipChildren: ['loan-list', 'money-ledger']
    });
    updateAccountLive();
  }

  function updateAccountLive() {
    const model = financeView.live(s);
    for (const [id, value] of Object.entries(model.fields)) DOM.text($(id), value);
    htmlIfChanged($('loan-list'), model.loans);
    htmlIfChanged($('money-ledger'), model.ledger);
  }

  function hubMarkers() {
    return HubList.map(h => {
      const p = display(h),
        st = forecast.hubStats?.[h.id],
        linked = !!st?.connections.length;
      return `<g data-hub="${h.id}" class="transport-hub ${linked?'linked':''}" role="button" tabindex="0" aria-label="交通枢纽 ${esc(h.name)}" transform="translate(${p.x} ${p.y})"><path d="M0 0L-17 -17"/><circle cx="-17" cy="-17" r="12"/><text class="hub-icon" x="-17" y="-13" text-anchor="middle">${h.icon}</text><text class="hub-label" x="1" y="-16">${esc(h.name)}</text><title>${esc(h.name)} · ${h.period} · ${num(RailHubs.daily(h))} 日均进出人次（折算）</title></g>`;
    }).join('');
  }

  function hubList() {
    return `<p class="station-note">${HubList.length} 处固定枢纽 · ${region==='gba'?'公开统计与明确标注的估算':'公开统计基准'}。就近设站并连向居民或就业区后形成接驳。</p><div class="hub-list">${HubList.map(h=>{const st=forecast.hubStats?.[h.id];return `<button data-hub="${h.id}"><i>${h.icon}</i><span><b>${esc(h.name)}</b><small>${h.period} · ${h.unit}</small><strong>${num(h.observed)}</strong><small>${st?.connections.length?'已连接 '+st.connections.length+' 站 · 模拟 '+num(st.riders)+' 人次/日':'尚未连接地铁'}</small></span><em>↗</em></button>`;}).join('')}</div>`;
  }

  function hubDetails(h) {
    const st = forecast.hubStats?.[h.id] || {
      ...RailHubs.envelope(h),
      riders: 0,
      arrivals: 0,
      departures: 0,
      connections: []
    };
    return `<button id="back-to-hubs" class="back-to-line">← 全部交通枢纽</button><div class="hub-source-badge">固定设施 · 不可编辑 · ${h.estimated?'游戏估算':'公开统计基准'}</div><div class="hub-observed"><span>${h.unit}</span><strong>${num(h.observed)}</strong><small>${h.period} · ${h.estimated?'模型假设':'公开统计'}</small></div><p>${esc(h.scope)}</p><div class="detail-row"><span>折算双向日均量</span><b>${num(st.movements)} 人次</b></div><p class="station-note">${h.basis==='daily-depart'?'仅上车量有观测值，下车按对称方向估算，再合并为双向量。':h.basis==='annual-both'?'年总量÷${h.days||365}，已包含到达与出发，不再次乘二。':'样本日均，已包含到达与出发，不再次乘二。'}</p><div class="section-title">当前城市阶段 · 接驳预测</div><div class="stat-grid"><div><span>进城 / 返回本地</span><strong>${num(st.arrivals)}<small>人次/日</small></strong></div><div><span>出城 / 访客返程</span><strong>${num(st.departures)}<small>人次/日</small></strong></div></div><div class="detail-row"><span>旅客接驳潜力</span><b>${num(st.passengerRiders??st.riders)} 人次/日</b></div>${RailHubs.access(h).staff?`<div class="detail-row"><span>机场职工通勤潜力</span><b>${num(st.staffRiders||0)} 人次/日</b></div><p class="station-note">机场内约 ${num(RailHubs.access(h).staff)} 名工作人员；出勤80%、居住分布及班次由模型估算，通勤从已有居民工作出行预算扣除。</p>`:''}<div class="detail-row"><span>当前城市释放比例</span><b>${((st.marketActivation??1)*100).toFixed(1)}%</b></div><div class="detail-row"><span>成熟轨道接驳参考 · 非实测份额</span><b>${num(st.referenceTarget||0)} 人次/日</b></div><div class="detail-row"><span>沿线访客分配比例 · 游戏模型</span><b>${((st.corridorCapture||0)*100).toFixed(1)}%</b></div><p class="station-note">一部分访客优先前往已连通的沿线城区；覆盖更多居民与岗位、提供更便利的服务可提高接驳。最多重分配${Math.round((s.urban?.version===19?.90:BAL.HUB_CAPTURE_MAX)*100)}%的访客市场，不代表地铁保证份额。</p>${st.visitorDestinationScale===undefined?'':`<div class="detail-row"><span>访客目的地供给释放</span><b>${Math.round(st.visitorDestinationScale*100)}%</b></div><p class="station-note">所有外部枢纽共享当前城市的商业、就业和到访承接规模，再按实际路径、票价和班次分配；公开枢纽总量保持原口径。</p>`}<div class="section-title">连接车站 · 步行 800 m 内</div>${st.connections.map(c=>`<div class="detail-row"><span>${esc(s.nodes[c.id].name)}</span><b>${(c.walk*1000).toFixed(0)} m</b></div>`).join('')||'<p>暂未连接。在枢纽附近建设车站，并接到城市功能区。</p>'}<details class="map-source"><summary>模型假设与数据口径</summary><p>陆侧可接驳比例 ${(h.landside*100).toFixed(0)}%，访客比例 ${(h.visitor*100).toFixed(0)}%，其余为本地城际出行；均为游戏假设。到达/出发对称，年均需求按日分配，尚无逐班时刻表。</p><p>居民出城从休闲预算中扣除，访客单独加入；访客市场采用全城分布与沿线分布混合，沿线占比随有效覆盖增加而饱和；两部分共享同一份访客总量。居民出城和职工通勤仍受原有预算约束。枢纽接驳使用独立的旅行时间价值和铁路倾向，不再与普通购物、骑行直接套用同一模型；仍受步行、票价、频率、换乘与覆盖范围约束。上方接驳量为容量约束前的需求估计。</p></details><p class="station-note">${esc(RailHubs.access(h).note)}</p><p class="hub-source-links">${RailHubs.access(h).source?`<a href="${RailHubs.access(h).source}" target="_blank" rel="noopener">接驳调查 ↗</a> · `:''}${RailHubs.access(h).staffSource?`<a href="${RailHubs.access(h).staffSource}" target="_blank" rel="noopener">职工数据 ↗</a> · `:''}<a href="${h.source}" target="_blank" rel="noopener">公开统计来源 ↗</a>${h.extraSource?` · <a href="${h.extraSource}" target="_blank" rel="noopener">JR 东海统计 ↗</a>`:''}</p>`;
  }

  function setDensity(on) {
    density = on ? 'urban' : 'off';
    $('density-toggle').checked = on;
    document.body.classList.toggle('density-mode', on);
    if (!on && inspection?.type === 'area') {
      inspection = null;
      render();
    } else {
      drawDensity();
      renderActivity();
    }
    if (!mode) $('map-hint').textContent = on ? '点击地图任意位置查看密度详情' : '滚轮 / 双击放大街道 · 点击线路查看详情';
  }

  function densityCells() {
    return cityCells.map(c => ({
      ...c,
      x: c.display.x,
      y: c.display.y
    }));
  }

  function densitySummary(p) {
    if (densityFieldRevision !== s.urban.revision || !densityField) {
      densityField = D.index(densityCells());
      densityFieldRevision = s.urban.revision;
    }
    const value = D.sample(densityField, display(p)),
      palette = D.PALETTE;
    return `<div class="urban-hero density-summary"><span>当前位置 · 连续密度色层</span><strong>${value.dominant?palette[value.dominant].name:'无密度'}<small>${value.level?'等级 '+value.level:'尚未开发'}</small></strong><p>白色无密度，颜色越深代表开发等级越高</p></div><div class="density-readings">${Object.entries(palette).map(([k,t])=>`<div><i style="background:rgb(${t.color})"></i><span>${t.name}</span><b>${num(value[k])}<small>${k==='r'?'人':'岗位'} / km² · ${D.level(k,value[k])?'Lv.'+D.level(k,value[k]):'无密度'}</small></b></div>`).join('')}</div><p class="station-note">色层由实际入驻人口、商业及工业岗位平滑插值；混合用途自然过渡。下方800米范围显示模型统计，插值用于展示。</p>`;
  }

  function drawDensity(force = false) {
    const off = density === 'off';
    $('density-canvas').hidden = off;
    $('density-legend').hidden = off;
    if (off) {
      if (densityPaintTimer) clearTimeout(densityPaintTimer);
      densityPaintTimer = null;
      return;
    }
    const now = performance.now();
    if (!force && now - lastDensityPaint < 75) {
      if (!densityPaintTimer) densityPaintTimer = setTimeout(() => {
        densityPaintTimer = null;
        drawDensity(true);
      }, 80);
      return;
    }
    lastDensityPaint = now;
    const canvas = $('density-canvas'),
      rect = $('map').getBoundingClientRect(),
      width = Math.max(1, Math.min(360, Math.ceil(rect.width / 3))),
      height = Math.max(1, Math.min(280, Math.ceil(rect.height / 3))),
      v = $('map').getAttribute('viewBox').split(' ').map(Number),
      cells = densityCells(),
      result = D.raster(cells, {
        x: v[0],
        y: v[1],
        w: v[2],
        h: v[3]
      }, width, height);
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(result.pixels, width, height), 0, 0);
    htmlIfChanged($('density-legend'),
      `<div class="density-keys"><span><i style="--density-color:#fff"></i>无密度</span><span><i style="--density-color:#238b56"></i>住宅</span><span><i style="--density-color:#e17f20"></i>商业</span><span><i style="--density-color:#8450ac"></i>工业</span></div><div class="density-ramp"><span>低等级</span><i></i><b>高等级</b></div><small>点击地图任意位置查看详情</small>`
    );
  }

  function queueTotals() {
    if(traffic.nativeView)return traffic.nativeView.stations;
    const counts = {};
    for (const [key, q] of Object.entries(traffic.queues)) {
      const id = +key.split('|')[2];
      counts[id] = (counts[id] || 0) + Object.values(q).reduce((a, b) => a + b, 0);
    }
    for (const x of traffic.transfers || []) counts[x.station] = (counts[x.station] || 0) + x.amount;
    return counts;
  }

  function renderStations() {
    if (!stationMenu) return;
    DOM.patchMarkup($('stations-panel'), stationsView.shell(stationQuery, stationSort), {
      preserveForms: true,
      skipChildren: ['station-rows']
    });
    updateStationRows();
  }

  function updateStationRows() {
    if (!stationMenu) return;
    const model = stationsView.model(s, traffic, stationQuery, stationSort, queueTotals());
    DOM.text($('station-count'), model.count);
    DOM.text($('station-waiting-total'), num(model.waiting));
    DOM.text($('busiest-station'), model.busiest ? model.busiest.name + ' · ' + num(model.busiest
      .waiting) : '—');
    DOM.text($('station-results'), model.rows.length + ' 座车站');
    $('stations-empty').hidden = model.count > 0;
    const markup = model.rows.map(row => stationsView.row(row, Q.station(s, row.id, traffic.minute),
      stationForecast(row.id).entry)).join('');
    DOM.reconcileHTML($('station-rows'), markup, 'data-station-row', {
      preserveClasses: ['station-alarm']
    });
  }
  document.addEventListener('input', e => {
    if (e.target.id === 'center-search') {
      centerQuery = e.target.value;
      filterCenter();
      return;
    }
    if (e.target.id === 'station-search') {
      stationQuery = e.target.value;
      updateStationRows();
    }
  });

  async function startNewGame() {
    setPlaying(false);
    await M.whenIdle(traffic);
    O.dispose(traffic);
    runtimeFault = '';
    networkRevision++;
    storageReadBlocked = false;
    syncRecords();
    persistRecords();
    utilityPanel = null;
    hoverPoint = null;
    s = M.init(N.upgrade(N.emptyWorld(region)));
    U.init(s);
    U.enableAutomatic(s, C.create(region), RailPlaceNames.places(region));
    U.enableDevelopment(s, C.create(region), RailPlaceNames.places(region));
    Q.enableSatisfaction(s);
    urbanDrawRevision = -1;
    densityField = null;
    urbanForecastRevision = s.urban.revision;
    forecast = C.evaluate(s);
    traffic = O.create(s, forecast);
    REVIEW.init(s, traffic);
    Q.updateSatisfaction(s, traffic);
    refreshUrbanMap();
    selected = null;
    overview = false;
    stationMenu = false;
    account = false;
    inspection = null;
    mode = null;
    draft = [];
    undoState = null;
    density = 'off';
    stationQuery = '';
    stationSort = 'waiting';
    speed = 6;
    $('speed').value = '6';
    $('density-toggle').checked = false;
    render();
    resetCamera();
    setPlaying(true);
    save();
    toast('新游戏已开始，初始余额 2.5 亿元。');
  }

  if (region === 'gba') {
    camera = display(B.project(22.95, 113.55, region));
    zoom = 2.3;
  }
  $('newgame-panel').querySelector('.reset-content p').prepend('仅重置「' + cfg.name + '」，其他地图存档保留。');
  $('speed').value = String(speed);
  render();
  setPlaying(playing);
  $('game-loading').remove();
  requestAnimationFrame(frame);
  document.dispatchEvent(new Event('rail-ready'));
  if (legacySaveText && !storageReadBlocked) save();
  if (storageReadBlocked) toast('未能完整读取本机存档，已暂停自动覆盖。可刷新重试或导入导出的文件。');
  else if (!storageOK) toast('尚未完成本地保存，请保留导出文件。');
  else if (migratedFacilities) {
    toast('城市设施已移交系统管理，原设施投资已退还，线路客流改由乘客满意度调节。');
  } else if (migratedUrban && s.services.length) {
    toast('已切换城市生长玩法：原线网、车辆、余额保留，人口从零逐步培育。');
  } else if (s.depot.migrationNotice) {
    toast(s.depot.migrationNotice);
    delete s.depot.migrationNotice;
    save();
  }

  function flyTo(x, y, z, duration = 480) {
    const r = $('map').getBoundingClientRect(),
      target = V.constrain({
        x,
        y
      }, z, r.width / Math.max(1, r.height), mapBounds);
    if (reducedMotion.matches) {
      camera = {
        x: target.x,
        y: target.y
      };
      zoom = target.zoom;
      cameraTween = null;
      applyCamera();
      return;
    }
    cameraTween = {
      at: 0,
      x: camera.x,
      y: camera.y,
      z: zoom,
      tx: target.x,
      ty: target.y,
      tz: target.zoom,
      duration
    };
  }

  function fitLine(id) {
    if (selected !== id || mode) return;
    const l = current();
    if (!l) return;
    const ns = X.linePoints(s, l).map(display),
      xs = ns.map(n => n.x),
      ys = ns.map(n => n.y),
      minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys),
      span = viewSpan(),
      z = Math.max(.85, Math.min(region === 'gba' ? 64 : 8, span.w * zoom / (maxX - minX + 150), span.h *
        zoom / (maxY - minY + 180)));
    flyTo((minX + maxX) / 2, (minY + maxY) / 2, z);
  }

})().catch(error => {
  console.error(error);
  const el = document.getElementById('game-loading');
  if (el) {
    el.textContent = '城市数据加载失败，请刷新重试。';
    const b = document.createElement('button');
    b.textContent = '重新加载';
    b.onclick = () => location.reload();
    el.appendChild(b);
  }
});
