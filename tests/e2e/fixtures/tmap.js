/**
 * 腾讯地图 GL 网页 SDK（https://map.qq.com/api/gljs）的替身：e2e 拦截 SDK 的地址换成它，测试不依赖外网
 *
 * 只实现基础库的 map 组件（网页实现）用到的部分，什么也不画：
 * - 视图：中心、缩放、偏移按 Web 墨卡托投影换算成容器里的位置，getBounds、projectToContainer、fitBounds 等都由此计算
 * - 手势：只认触摸事件（wxa-runner 把鼠标转成触摸）。按下抬起没有移动是点击：点中标记点时标记点图层先派发 click，
 *   地图随后也派发 click，和真实 SDK 一样；移动超过阈值是拖动，派发 dragstart / dragend
 * - 标记点按 MarkerStyle 的宽高和锚点判断是否点中；DOMOverlay（气泡、label、定位点）是真实的 DOM，能直接点
 *
 * 和真实 SDK 一样，加载完调用地址里 callback 参数指定的全局函数。
 */
(function () {
  const TILE_SIZE = 256;
  const DRAG_THRESHOLD = 5;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  class Emitter {
    on(type, listener) {
      this.listeners = this.listeners || {};
      (this.listeners[type] = this.listeners[type] || []).push(listener);
      return this;
    }
    off(type, listener) {
      if (this.listeners?.[type]) this.listeners[type] = this.listeners[type].filter(item => item !== listener);
      return this;
    }
    emit(type, event) {
      for (const listener of this.listeners?.[type]?.slice() || []) listener(event);
    }
    removeAllListeners() {
      this.listeners = {};
    }
  }

  class LatLng {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
    getLat() {
      return this.lat;
    }
    getLng() {
      return this.lng;
    }
  }

  class LatLngBounds {
    constructor(sw, ne) {
      this.sw = sw || null;
      this.ne = ne || null;
    }
    extend(latLng) {
      this.sw = new LatLng(Math.min(this.sw?.lat ?? latLng.lat, latLng.lat), Math.min(this.sw?.lng ?? latLng.lng, latLng.lng));
      this.ne = new LatLng(Math.max(this.ne?.lat ?? latLng.lat, latLng.lat), Math.max(this.ne?.lng ?? latLng.lng, latLng.lng));
      return this;
    }
    getSouthWest() {
      return this.sw;
    }
    getNorthEast() {
      return this.ne;
    }
    isEmpty() {
      return !this.sw;
    }
  }

  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    getX() {
      return this.x;
    }
    getY() {
      return this.y;
    }
  }

  /** 经纬度 → 缩放级别 zoom 下的世界像素坐标 */
  function toWorld(latLng, zoom) {
    const size = TILE_SIZE * 2 ** zoom;
    const sin = Math.sin((latLng.lat * Math.PI) / 180);
    return { x: ((latLng.lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
  }

  function fromWorld(point, zoom) {
    const size = TILE_SIZE * 2 ** zoom;
    const n = Math.PI - (2 * Math.PI * point.y) / size;
    return new LatLng((180 / Math.PI) * Math.atan(Math.sinh(n)), (point.x / size) * 360 - 180);
  }

  class MapView extends Emitter {
    constructor(container, options = {}) {
      super();
      this.container = container;
      this.center = options.center || new LatLng(39.908823, 116.39747);
      this.minZoom = options.minZoom ?? 3;
      this.maxZoom = options.maxZoom ?? 20;
      this.zoom = clamp(options.zoom ?? 17, this.minZoom, this.maxZoom);
      this.rotation = options.rotation || 0;
      this.pitch = options.pitch || 0;
      this.offset = { x: 0, y: 0 };
      this.draggable = options.draggable !== false;
      this.overlays = new Set();
      this.layers = new Set();

      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      this.panel = document.createElement('div');
      this.panel.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden;';
      container.appendChild(this.panel);
      this.listenTouches();
    }

    listenTouches() {
      let last = null;
      let start = null;
      let dragging = false;
      const toPoint = touch => {
        const rect = this.container.getBoundingClientRect();
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      };
      this.panel.addEventListener('touchstart', event => {
        start = last = toPoint(event.touches[0]);
        dragging = false;
      });
      this.panel.addEventListener('touchmove', event => {
        if (!start || !this.draggable) return;
        const now = toPoint(event.touches[0]);
        if (!dragging && Math.hypot(now.x - start.x, now.y - start.y) < DRAG_THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          this.emit('dragstart');
        }
        const center = toWorld(this.center, this.zoom);
        this.center = fromWorld({ x: center.x - (now.x - last.x), y: center.y - (now.y - last.y) }, this.zoom);
        last = now;
        this.render();
      });
      this.panel.addEventListener('touchend', event => {
        if (!start) return;
        start = null;
        if (dragging) {
          this.emit('dragend');
          return;
        }
        const point = toPoint(event.changedTouches[0]);
        const layers = [...this.layers].reverse();
        for (const layer of layers) {
          const geometry = layer.hitTest?.(point);
          if (geometry) {
            layer.emit('click', { geometry, latLng: geometry.position });
            break;
          }
        }
        this.emit('click', { latLng: this.unprojectFromContainer(new Point(point.x, point.y)), poi: null });
      });
    }

    render() {
      for (const overlay of this.overlays) overlay.updateDOM();
    }

    projectToContainer(latLng) {
      const center = toWorld(this.center, this.zoom);
      const point = toWorld(latLng, this.zoom);
      return new Point(
        point.x - center.x + this.container.offsetWidth / 2 + this.offset.x,
        point.y - center.y + this.container.offsetHeight / 2 + this.offset.y
      );
    }

    unprojectFromContainer(point) {
      const center = toWorld(this.center, this.zoom);
      return fromWorld({
        x: point.getX() - this.container.offsetWidth / 2 - this.offset.x + center.x,
        y: point.getY() - this.container.offsetHeight / 2 - this.offset.y + center.y
      }, this.zoom);
    }

    getBounds() {
      const { offsetWidth: width, offsetHeight: height } = this.container;
      return new LatLngBounds(this.unprojectFromContainer(new Point(0, height)), this.unprojectFromContainer(new Point(width, 0)));
    }

    getCenter() {
      return new LatLng(this.center.lat, this.center.lng);
    }
    setCenter(latLng) {
      this.center = new LatLng(latLng.getLat(), latLng.getLng());
      this.render();
    }
    panTo(latLng) {
      this.setCenter(latLng);
    }
    getZoom() {
      return this.zoom;
    }
    zoomTo(zoom) {
      this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
      this.render();
    }
    getRotation() {
      return this.rotation;
    }
    rotateTo(rotation) {
      this.rotation = rotation;
    }
    getPitch() {
      return this.pitch;
    }
    pitchTo(pitch) {
      this.pitch = pitch;
    }
    easeTo({ center, zoom, rotation, pitch }) {
      if (center) this.center = new LatLng(center.getLat(), center.getLng());
      if (zoom !== undefined) this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
      if (rotation !== undefined) this.rotation = rotation;
      if (pitch !== undefined) this.pitch = pitch;
      this.render();
    }
    /** 缩放到刚好装下 bounds，中心放在 bounds 的中心 */
    fitBounds(bounds, { padding = 0 } = {}) {
      const pad = typeof padding === 'number'
        ? { top: padding, right: padding, bottom: padding, left: padding }
        : { top: 0, right: 0, bottom: 0, left: 0, ...padding };
      const sw = toWorld(bounds.getSouthWest(), 0);
      const ne = toWorld(bounds.getNorthEast(), 0);
      const width = Math.max(this.container.offsetWidth - pad.left - pad.right, 1);
      const height = Math.max(this.container.offsetHeight - pad.top - pad.bottom, 1);
      const scale = Math.min(width / Math.max(ne.x - sw.x, 1e-9), height / Math.max(sw.y - ne.y, 1e-9));
      this.zoom = clamp(Math.log2(scale), this.minZoom, this.maxZoom);
      this.center = fromWorld({ x: (sw.x + ne.x) / 2, y: (sw.y + ne.y) / 2 }, 0);
      this.render();
    }
    setOffset(offset) {
      this.offset = { x: offset.x, y: offset.y };
      this.render();
    }
    setDraggable(draggable) {
      this.draggable = draggable;
    }
    setMinZoom(zoom) {
      this.minZoom = zoom;
    }
    setMaxZoom(zoom) {
      this.maxZoom = zoom;
    }
    setBoundary() {}
    setScrollable() {}
    setDoubleClickZoom() {}
    setBaseMap() {}
    setMapStyleId() {}
    getControl(id) {
      return { id };
    }
    addControl() {}
    removeControl() {}
    destroy() {
      this.panel.remove();
      this.overlays.clear();
      this.layers.clear();
    }
  }

  /** 基础库用 TMap.DOMOverlay.call(this, options) 继承，new TMap.DOMOverlay() 当子类的原型，所以不能是 class */
  function DOMOverlay(options) {
    if (!options) return;
    this.onInit?.(options);
    this.dom = this.createDOM();
    this.setMap(options.map || null);
  }
  Object.setPrototypeOf(DOMOverlay.prototype, Emitter.prototype);
  DOMOverlay.prototype.setMap = function (map) {
    if (this.map) {
      this.map.overlays.delete(this);
      this.dom.remove();
    }
    this.map = map;
    if (map) {
      map.panel.appendChild(this.dom);
      map.overlays.add(this);
      this.updateDOM();
    }
  };
  DOMOverlay.prototype.updateDOM = function () {};
  DOMOverlay.prototype.destroy = function () {
    this.onDestroy?.();
    this.setMap(null);
  };

  class Style {
    constructor(options) {
      Object.assign(this, options);
    }
  }

  /** 图层：MultiMarker、MarkerCluster、MultiPolyline 等，按 id 管理几何 */
  class Layer extends Emitter {
    constructor(options = {}) {
      super();
      this.styles = { ...options.styles };
      this.geometries = new Map();
      this.updateGeometries(options.geometries || []);
      this.setMap(options.map || null);
    }
    setMap(map) {
      this.map?.layers.delete(this);
      this.map = map;
      map?.layers.add(this);
      return this;
    }
    getStyles() {
      return this.styles;
    }
    setStyles(styles) {
      this.styles = { ...styles };
      return this;
    }
    setGeometries(geometries) {
      this.geometries.clear();
      return this.updateGeometries(geometries);
    }
    updateGeometries(geometries) {
      for (const geometry of geometries) this.geometries.set(String(geometry.id), { ...geometry, id: String(geometry.id) });
      return this;
    }
    getGeometryById(id) {
      return this.geometries.get(String(id)) || null;
    }
    remove(ids) {
      for (const id of ids) this.geometries.delete(String(id));
      return this;
    }
  }

  class MultiMarker extends Layer {
    /** 点中的标记点，后加的在上面。基础库总会给出样式的宽高和锚点 */
    hitTest(point) {
      return [...this.geometries.values()].reverse().find(geometry => {
        const { width, height, anchor } = this.styles[geometry.styleId];
        const position = this.map.projectToContainer(geometry.position);
        const left = position.getX() - anchor.x;
        const top = position.getY() - anchor.y;
        return point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height;
      });
    }
    /** 不做动画：过了 duration 毫秒直接到终点 */
    moveAlong(paths) {
      for (const [id, { path, duration }] of Object.entries(paths)) {
        setTimeout(() => {
          const geometry = this.getGeometryById(id);
          if (geometry) geometry.position = path[path.length - 1];
          this.emit('moving', {});
          this.emit('move_ended', {});
        }, duration || 0);
      }
    }
  }

  class MarkerCluster extends Layer {
    getClusters() {
      return [];
    }
  }

  window.TMap = {
    LatLng,
    LatLngBounds,
    Point,
    Map: MapView,
    DOMOverlay,
    MultiMarker,
    MarkerStyle: Style,
    MarkerCluster,
    MultiPolyline: Layer,
    PolylineStyle: Style,
    MultiPolygon: Layer,
    PolygonStyle: Style,
    MultiCircle: Layer,
    CircleStyle: Style,
    constants: { DEFAULT_CONTROL_ID: { SCALE: 'scale', ROTATION: 'rotation', ZOOM: 'zoom', FLOOR: 'floor' } }
  };

  const callback = new URL(document.currentScript.src).searchParams.get('callback');
  if (callback) window[callback]();
})();
