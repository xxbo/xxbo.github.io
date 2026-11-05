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
  const UI_VERSION = '43';
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
    createWorker: () => typeof Worker === 'function' ? new Worker('demand-worker.js?v=43') : null,
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
        runtime: O.snapshot(traffic),
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
      if (ov…37232 tokens truncated…</em></button>`;}).join('')}</div>`;
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

  function startNewGame() {
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
