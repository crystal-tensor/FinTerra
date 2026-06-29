import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import L from "leaflet";
import * as THREE from "three";
import {
  Bot,
  CheckSquare,
  CircleHelp,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Network,
  Newspaper,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  X
} from "lucide-react";
import { SiteTopNav } from "./portalHome.jsx";

const tabLabels = {
  all: "全部",
  risk: "风险",
  flow: "资金",
  news: "信息"
};

const typeLabels = {
  all: "全部资产",
  equity: "股票",
  rates: "债券",
  fx: "外汇",
  commodity: "商品",
  crypto: "加密"
};

const regionLabels = {
  global: "全球",
  unitedStates: "美国",
  canada: "加拿大",
  brazil: "巴西",
  china: "中国",
  hongKong: "香港",
  japan: "日本",
  korea: "韩国",
  australia: "澳大利亚",
  unitedKingdom: "英国",
  germany: "德国",
  france: "法国",
  eurozone: "欧元区"
};

const hiddenCategoryIds = new Set(["china-hk", "europe"]);

const graphColors = {
  asset: "#22d3ee",
  news: "#34d399",
  category: "#a78bfa",
  entity: "#f59e0b"
};

const worldBounds = [
  [-58, -171],
  [74, 171]
];

function formatChange(value) {
  if (!Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildSimulationPlaybackEvents(payload) {
  const events = [
    { line: "读取 news 目录与 RSS 快照完成。" },
    ...(payload.stages || []).map((stage) => ({ line: `${stage.name}: ${stage.detail}` }))
  ];
  if (payload.roles?.length) {
    events.push({ line: `角色生成: ${payload.roles.map((role) => role.name).join("、")}` });
  }
  (payload.rounds || []).forEach((round) => {
    events.push({ line: `第${round.round}轮讨论 - ${round.focus}` });
    (round.turns || []).forEach((turn) => {
      events.push({
        line: `${turn.roleName}: ${turn.message}`,
        focus: {
          nodeIds: turn.focusNodeIds || [],
          edgeIds: turn.focusEdgeIds || []
        }
      });
    });
    const roundNodeIds = [...new Set((round.turns || []).flatMap((turn) => turn.focusNodeIds || []))];
    const roundEdgeIds = [...new Set((round.turns || []).flatMap((turn) => turn.focusEdgeIds || []))];
    events.push({
      line: round.summary || `第${round.round}轮总结：暂无总结。`,
      focus: { nodeIds: roundNodeIds, edgeIds: roundEdgeIds }
    });
  });
  events.push({ line: `最终结论:\n${payload.answer || "暂无结果"}` });
  return events;
}

function readStoredModelConfig() {
  try {
    const raw = window.localStorage.getItem("finterraModelConfig");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (/deepseek-v4/i.test(parsed?.model || "")) {
      return null;
    }
    if (parsed?.api_key || parsed?.apiKey) return parsed;
  } catch {
    // Ignore malformed local model config.
  }
  return null;
}

function readAnyStoredModelConfig() {
  try {
    const raw = window.localStorage.getItem("finterraModelConfig");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (/deepseek-v4/i.test(parsed?.model || "")) {
      return null;
    }
    return parsed;
  } catch {
    // Ignore malformed local model config.
  }
  return null;
}

function regionMatch(node, region) {
  if (region === "global") return true;
  if (region === "unitedStates") return node.country === "United States";
  if (region === "canada") return node.country === "Canada";
  if (region === "brazil") return node.country === "Brazil";
  if (region === "china") return node.country === "China";
  if (region === "hongKong") return node.country === "Hong Kong";
  if (region === "japan") return node.country === "Japan";
  if (region === "korea") return node.country === "South Korea";
  if (region === "australia") return node.country === "Australia";
  if (region === "india") return node.country === "India";
  if (region === "unitedKingdom") return node.country === "United Kingdom";
  if (region === "germany") return node.country === "Germany";
  if (region === "france") return node.country === "France";
  if (region === "eurozone") return node.country === "Eurozone";
  if (region === "fx") return node.region === "FX";
  if (region === "rates") return node.region === "Rates";
  if (region === "commodities") return node.region === "Commodities";
  if (region === "crypto") return node.region === "Crypto";
  return true;
}

function tabMatch(tab, node) {
  if (tab === "all") return true;
  if (tab === "risk") return ["equity", "commodity", "crypto"].includes(node.type);
  if (tab === "flow") return ["fx", "rates"].includes(node.type);
  if (tab === "news") return ["spx", "nasdaq", "ust10y", "dxy", "gold", "crude", "btc", "hsi", "shcomp"].includes(node.id);
  return true;
}

function eventToneClass(event) {
  if (event.sentiment === "positive") return "positive";
  if (event.sentiment === "negative") return "negative";
  return "watch";
}

function averageCoordinate(items) {
  const coords = items
    .map((item) => ({ lat: Number(item.lat), lon: Number(item.lon) }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  if (!coords.length) return null;
  return {
    lat: coords.reduce((sum, item) => sum + item.lat, 0) / coords.length,
    lon: coords.reduce((sum, item) => sum + item.lon, 0) / coords.length
  };
}

function buildMapGraphOverlay(graph, marketData, selectedCategoryIds) {
  if (!graph?.nodes?.length || !graph?.news?.length) return { nodes: [], edges: [] };
  const selected = new Set(selectedCategoryIds || []);
  const marketById = new Map((marketData?.nodes || []).map((node) => [node.id, node]));
  const coords = new Map();
  const newsItems = graph.news.filter((item) => !selected.size || selected.has(item.category));

  newsItems.forEach((item) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    coords.set(`news:${item.id}`, { lat, lon });
    const asset = marketById.get(item.relatedNodeId);
    if (asset && Number.isFinite(Number(asset.lat)) && Number.isFinite(Number(asset.lon))) {
      coords.set(`asset:${item.relatedNodeId}`, { lat: Number(asset.lat), lon: Number(asset.lon) });
    }
  });

  const categoryGroups = new Map();
  newsItems.forEach((item) => {
    categoryGroups.set(item.category, [...(categoryGroups.get(item.category) || []), item]);
  });
  categoryGroups.forEach((items, category) => {
    const coord = averageCoordinate(items);
    if (coord) coords.set(`cat:${category}`, coord);
  });

  const entityGroups = new Map();
  (graph.edges || []).forEach((edge) => {
    if (!String(edge.source).startsWith("news:") || !String(edge.target).startsWith("entity:")) return;
    const coord = coords.get(edge.source);
    if (!coord) return;
    entityGroups.set(edge.target, [...(entityGroups.get(edge.target) || []), coord]);
  });
  entityGroups.forEach((items, entityId) => {
    const coord = averageCoordinate(items);
    if (coord) coords.set(entityId, coord);
  });

  const nodes = graph.nodes
    .filter((node) => coords.has(node.id))
    .map((node) => ({ ...node, ...coords.get(node.id) }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (graph.edges || [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, 420)
    .map((edge, index) => ({
      ...edge,
      id: `${edge.source}->${edge.target}:${edge.relation || index}`,
      sourceCoord: coords.get(edge.source),
      targetCoord: coords.get(edge.target)
    }));

  return { nodes, edges };
}

function buildAmbientGraphFocus(overlay, offset = 0) {
  const nodes = overlay?.nodes || [];
  const edges = overlay?.edges || [];
  if (!nodes.length && !edges.length) return null;
  const pick = (items, count) => {
    if (!items.length) return [];
    return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[(offset + index) % items.length]?.id).filter(Boolean);
  };
  return {
    nodeIds: pick(nodes, 10),
    edgeIds: pick(edges, 18)
  };
}

function useEChart(option, deps) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    chartRef.current = echarts.init(ref.current);
    return () => chartRef.current?.dispose();
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, deps);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return ref;
}

function IntelMap({ assets, news, graphOverlay, activeGraphFocus, selectedAssetId, selectedNewsId, onAssetSelect, onNewsSelect }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const assetLayerRef = useRef(null);
  const newsLayerRef = useRef(null);
  const graphLayerRef = useRef(null);
  const assetMarkers = useRef(new Map());
  const newsMarkers = useRef(new Map());
  const [zoom, setZoom] = useState(2);

  useEffect(() => {
    if (!ref.current || mapRef.current) return undefined;
    const map = L.map(ref.current, {
      center: [12, 20],
      zoom: 2,
      minZoom: 2,
      maxZoom: 19,
      zoomControl: false,
      scrollWheelZoom: true,
      wheelDebounceTime: 18,
      wheelPxPerZoomLevel: 72,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      dragging: true,
      worldCopyJump: true
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      className: "finance-basemap",
      subdomains: "abcd",
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    assetLayerRef.current = L.layerGroup().addTo(map);
    newsLayerRef.current = L.layerGroup().addTo(map);
    graphLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.fitBounds(worldBounds, { padding: [24, 24], animate: false });
    map.on("zoomend", () => setZoom(map.getZoom()));
    window.setTimeout(() => map.invalidateSize(), 80);
    return () => map.remove();
  }, []);

  useEffect(() => {
    const assetLayer = assetLayerRef.current;
    const newsLayer = newsLayerRef.current;
    if (!assetLayer || !newsLayer) return;
    assetLayer.clearLayers();
    newsLayer.clearLayers();
    assetMarkers.current.clear();
    newsMarkers.current.clear();

    assets.forEach((asset) => {
      if (!Number.isFinite(asset.lat) || !Number.isFinite(asset.lon)) return;
      const marker = L.marker([asset.lat, asset.lon], {
        title: asset.label,
        icon: L.divIcon({
          className: "leaflet-finance-marker-wrap",
          html: `<div class="leaflet-finance-marker ${Number(asset.changePct || 0) >= 0 ? "up" : "down"}"><span>${asset.symbol || asset.id}</span></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      });
      marker.bindPopup(`<strong>${asset.label}</strong><br/>${asset.symbol || asset.id} · ${formatChange(asset.changePct)}`);
      marker.on("click", () => onAssetSelect(asset));
      marker.addTo(assetLayer);
      assetMarkers.current.set(asset.id, marker);
    });

    news.forEach((item) => {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
      const marker = L.marker([item.lat, item.lon], {
        title: item.title,
        icon: L.divIcon({
          className: "leaflet-intel-marker-wrap",
          html: `<div class="leaflet-intel-marker ${eventToneClass(item)}"><span>N</span></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      });
      marker.bindPopup(`<strong>${item.title}</strong><br/>${item.source || "news"} · ${item.locationLabel || "资讯发生地"} · 影响 ${item.relatedLabel || ""}`);
      marker.on("click", () => onNewsSelect(item));
      marker.addTo(newsLayer);
      newsMarkers.current.set(item.id, marker);
    });
  }, [assets, news, onAssetSelect, onNewsSelect]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = selectedAssetId ? assetMarkers.current.get(selectedAssetId) : selectedNewsId ? newsMarkers.current.get(selectedNewsId) : null;
    if (!map || !marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 7), { duration: 0.9 });
    window.setTimeout(() => marker.openPopup(), 360);
  }, [selectedAssetId, selectedNewsId]);

  useEffect(() => {
    const layer = graphLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!graphOverlay?.nodes?.length) return;

    const activeEdges = new Set(activeGraphFocus?.edgeIds || []);
    const activeNodes = new Set(activeGraphFocus?.nodeIds || []);
    graphOverlay.edges.forEach((edge) => {
      if (!activeEdges.has(edge.id)) return;
      activeNodes.add(edge.source);
      activeNodes.add(edge.target);
    });

    graphOverlay.edges.forEach((edge) => {
      const source = edge.sourceCoord;
      const target = edge.targetCoord;
      if (!source || !target) return;
      const active = activeEdges.has(edge.id);
      L.polyline([[source.lat, source.lon], [target.lat, target.lon]], {
        className: `lab-graph-map-edge ${active ? "active" : ""}`,
        color: active ? "#67e8f9" : "#94a3b8",
        opacity: active ? 0.72 : 0.2,
        weight: active ? 1.6 : 0.65,
        interactive: false
      }).addTo(layer);
    });

    graphOverlay.nodes.forEach((node) => {
      const active = activeNodes.has(node.id);
      const marker = L.circleMarker([node.lat, node.lon], {
        className: `lab-graph-map-node ${node.type} ${active ? "active" : ""}`,
        radius: node.type === "news" ? 3.2 : node.type === "asset" ? 4.4 : 3.6,
        color: active ? "#cffafe" : graphColors[node.type] || "#94a3b8",
        fillColor: graphColors[node.type] || "#94a3b8",
        fillOpacity: active ? 0.78 : 0.36,
        opacity: active ? 0.95 : 0.36,
        weight: active ? 1.5 : 0.7
      });
      marker.bindTooltip(`${node.label || node.id}<br/>${node.type}`, { direction: "top", opacity: 0.86 });
      marker.addTo(layer);
    });
  }, [graphOverlay, activeGraphFocus]);

  const reset = () => {
    mapRef.current?.fitBounds(worldBounds, { padding: [24, 24], animate: true, duration: 0.8 });
    mapRef.current?.closePopup();
  };

  return (
    <div className="lab-map-stage">
      <div ref={ref} className="leaflet-map" aria-label="全球金融资讯推演地图" />
      <div className="lab-map-actions">
        <button type="button" onClick={reset} title="全球视图">
          <RotateCcw size={15} />
          全球视图
        </button>
        <span>Zoom {zoom.toFixed(1)}</span>
      </div>
    </div>
  );
}

function FloatingWindow({ id, title, icon: Icon, visible, onHide, children, className = "", headerAction = null, dragOffset = { x: 0, y: 0 }, active = false, onMove, onFocus }) {
  const dragRef = useRef(null);
  if (!visible) return null;

  const startDrag = (event) => {
    if (event.target.closest("button")) return;
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onFocus?.(id);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y
    };
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onMove?.(id, {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    });
  };

  const endDrag = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const startMouseDrag = (event) => {
    if (event.target.closest("button") || dragRef.current) return;
    event.preventDefault();
    onFocus?.(id);
    const origin = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y
    };
    const onMouseMove = (moveEvent) => {
      onMove?.(id, {
        x: origin.originX + moveEvent.clientX - origin.startX,
        y: origin.originY + moveEvent.clientY - origin.startY
      });
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <section
      className={`lab-float-window ${active ? "drag-active" : ""} ${className}`}
      style={{ transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)` }}
      onPointerDown={() => onFocus?.(id)}
    >
      <div
        className="lab-window-head"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseDown={startMouseDrag}
        onDoubleClick={() => onMove?.(id, { x: 0, y: 0 })}
      >
        <span>{Icon && <Icon size={16} />}{title}</span>
        <div className="lab-window-tools">
          {headerAction}
          <button type="button" onClick={() => onHide(id)} title="隐藏">
            <EyeOff size={14} />
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

function FinancialGraph({ graph, activeGraphFocus }) {
  const option = useMemo(() => {
    const activeNodes = new Set(activeGraphFocus?.nodeIds || []);
    const activeEdges = new Set(activeGraphFocus?.edgeIds || []);
    const nodes = (graph?.nodes || []).slice(0, 360).map((node) => ({
      name: node.id,
      value: node.value,
      symbolSize: (node.type === "news" ? 7 : node.type === "asset" ? 15 : node.type === "category" ? 20 : 10) + (activeNodes.has(node.id) ? 8 : 0),
      itemStyle: {
        color: activeNodes.has(node.id) ? "#67e8f9" : graphColors[node.type] || "#94a3b8",
        shadowBlur: activeNodes.has(node.id) ? 22 : 0,
        shadowColor: "rgba(103, 232, 249, 0.85)"
      },
      label: { show: node.type !== "news", formatter: node.label, color: "#dbeafe", fontSize: 10 },
      raw: node
    }));
    const ids = new Set(nodes.map((node) => node.name));
    return {
      backgroundColor: "transparent",
      tooltip: {
        formatter: (params) => params.data?.raw?.label || params.name
      },
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        top: 6,
        bottom: 6,
        left: 6,
        right: 6,
        force: { repulsion: 110, edgeLength: [24, 96], gravity: 0.06 },
        lineStyle: { color: "#6b7b91", width: 0.7, opacity: 0.32, curveness: 0.12 },
        data: nodes,
        links: (graph?.edges || []).filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(0, 520).map((edge, index) => {
          const edgeId = `${edge.source}->${edge.target}:${edge.relation || index}`;
          const active = activeEdges.has(edgeId);
          return {
            ...edge,
            id: edgeId,
            lineStyle: active ? { color: "#67e8f9", width: 2.4, opacity: 0.86, curveness: 0.14 } : undefined
          };
        })
      }]
    };
  }, [graph, activeGraphFocus]);
  const ref = useEChart(option, [option]);
  return <div ref={ref} className="lab-financial-graph" />;
}

function latLonToVector3(lat, lon, radius = 1) {
  const phi = THREE.MathUtils.degToRad(lat);
  const theta = THREE.MathUtils.degToRad(lon + 90);
  const cosPhi = Math.cos(phi);
  return new THREE.Vector3(
    radius * cosPhi * Math.sin(theta),
    radius * Math.sin(phi),
    radius * cosPhi * Math.cos(theta)
  );
}

function nodeColorForSentiment(sentiment) {
  if (sentiment === "positive") return "#34d399";
  if (sentiment === "negative") return "#ff4d4f";
  return "#22d3ee";
}

function tangentBasis(lat, lon) {
  const phi = THREE.MathUtils.degToRad(lat);
  const theta = THREE.MathUtils.degToRad(lon + 90);
  const east = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)).normalize();
  const north = new THREE.Vector3(-Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta)).normalize();
  return { east, north };
}

function shortNodeLabel(title) {
  const value = String(title || "").replace(/[【】]/g, "").trim();
  return value.length > 9 ? `${value.slice(0, 9)}…` : value;
}

function buildGlobeNewsNodes(graph) {
  const source = (graph?.news || [])
    .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
    .slice(0, 360);
  const clusters = new Map();
  source.forEach((item) => {
    const key = `${Number(item.lat).toFixed(1)}:${Number(item.lon).toFixed(1)}`;
    clusters.set(key, [...(clusters.get(key) || []), item]);
  });

  return source.map((item) => {
    const key = `${Number(item.lat).toFixed(1)}:${Number(item.lon).toFixed(1)}`;
    const cluster = clusters.get(key) || [];
    const clusterIndex = cluster.findIndex((entry) => entry.id === item.id);
    const clusterSize = cluster.length;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const normal = latLonToVector3(lat, lon, 1).normalize();
    const { east, north } = tangentBasis(lat, lon);
    const surface = latLonToVector3(lat, lon, 1.018);
    const ring = Math.floor(Math.sqrt(Math.max(0, clusterIndex)));
    const angle = clusterIndex * 2.399963 + ring * 0.38;
    const shouldOrbit = clusterSize > 4;
    const tangentDistance = shouldOrbit ? 0.04 + ring * 0.021 : clusterIndex * 0.006;
    const lift = shouldOrbit ? Math.min(0.72, 0.11 + ring * 0.038) : 0.026 + clusterIndex * 0.006;
    const tangent = east.clone().multiplyScalar(Math.cos(angle) * tangentDistance).add(north.clone().multiplyScalar(Math.sin(angle) * tangentDistance));
    const position = normal.clone().multiplyScalar(1.035 + lift).add(tangent);
    const chinaFocus = item.geoScope === "China" || item.geoScope === "Hong Kong" || /中国|香港/.test(item.locationLabel || "");
    return {
      ...item,
      clusterIndex,
      clusterSize,
      chinaFocus,
      lifted: shouldOrbit,
      color: nodeColorForSentiment(item.sentiment),
      label: shortNodeLabel(item.title),
      surface,
      position
    };
    });
}

function addGlobeGrid(group) {
  const material = new THREE.LineBasicMaterial({ color: 0x6f8299, transparent: true, opacity: 0.2 });
  for (let lat = -60; lat <= 60; lat += 30) {
    const points = [];
    for (let lon = -180; lon <= 180; lon += 4) points.push(latLonToVector3(lat, lon, 1.006));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const points = [];
    for (let lat = -80; lat <= 80; lat += 4) points.push(latLonToVector3(lat, lon, 1.008));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
}

function createNodeLabelSprite(label, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.font = "700 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  context.fillStyle = "rgba(3, 12, 22, 0.68)";
  context.strokeStyle = "rgba(148, 163, 184, 0.26)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(4, 10, 248, 42, 18);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.arc(24, 31, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(236, 248, 255, 0.92)";
  context.fillText(label, 38, 38);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.86, depthWrite: false }));
  sprite.scale.set(0.32, 0.08, 1);
  sprite.userData.texture = texture;
  return sprite;
}

function GlobeFinancialGraph({ graph }) {
  const mountRef = useRef(null);
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const globeNodes = useMemo(() => buildGlobeNewsNodes(graph), [graph]);
  const chinaNodeCount = useMemo(() => globeNodes.filter((node) => node.chinaFocus).length, [globeNodes]);

  useEffect(() => {
    const mount = mountRef.current;
    const canvas = canvasRef.current;
    if (!mount || !canvas) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 3.25);

    const globeGroup = new THREE.Group();
    globeGroup.rotation.y = 2.58;
    scene.add(globeGroup);

    const earthTexture = new THREE.TextureLoader().load("/textures/earth-atmos-2048.jpg");
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshStandardMaterial({
        map: earthTexture,
        color: 0xffffff,
        roughness: 0.68,
        metalness: 0.02
      })
    );
    globeGroup.add(earth);
    addGlobeGrid(globeGroup);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.055, 96, 64),
      new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.045, side: THREE.BackSide })
    );
    globeGroup.add(atmosphere);

    scene.add(new THREE.AmbientLight(0x8fb4d8, 1.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(2.6, 2.1, 3.2);
    scene.add(keyLight);

    const nodeMeshes = [];
    const labelSprites = [];
    const nodeGeometry = new THREE.SphereGeometry(0.014, 12, 8);
    const anchorGeometry = new THREE.SphereGeometry(0.006, 8, 6);
    const satelliteLineMaterial = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.2 });

    globeNodes.forEach((node) => {
      const mesh = new THREE.Mesh(
        nodeGeometry,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(node.color), transparent: true, opacity: node.lifted ? 0.94 : 0.78 })
      );
      mesh.position.copy(node.position);
      mesh.scale.setScalar((node.lifted ? 1.32 : 1) * (node.chinaFocus ? 1.26 : 1));
      mesh.userData = node;
      globeGroup.add(mesh);
      nodeMeshes.push(mesh);
      if (node.lifted) {
        const anchor = new THREE.Mesh(
          anchorGeometry,
          new THREE.MeshBasicMaterial({ color: new THREE.Color(node.color), transparent: true, opacity: 0.38 })
        );
        anchor.position.copy(node.surface);
        globeGroup.add(anchor);
        globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([node.surface, node.position]), satelliteLineMaterial));
      }
      if (node.clusterIndex % (node.chinaFocus ? 5 : 9) === 0 || node.sentiment === "negative") {
        const label = createNodeLabelSprite(node.label, node.color);
        label.position.copy(node.position.clone().multiplyScalar(1.035));
        globeGroup.add(label);
        labelSprites.push(label);
      }
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { active: false, x: 0, y: 0 };

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(280, rect.width);
      const height = Math.max(330, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const onPointerDown = (event) => {
      drag.active = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      if (drag.active) {
        globeGroup.rotation.y += (event.clientX - drag.x) * 0.006;
        globeGroup.rotation.x += (event.clientY - drag.y) * 0.004;
        globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x, -1.05, 1.05);
        drag.x = event.clientX;
        drag.y = event.clientY;
      }
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(nodeMeshes, false)[0];
      setTooltip(hit ? {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        title: hit.object.userData.title,
        source: hit.object.userData.source,
        related: hit.object.userData.relatedLabel,
        location: hit.object.userData.locationLabel
      } : null);
    };
    const onPointerUp = (event) => {
      drag.active = false;
      canvas.releasePointerCapture?.(event.pointerId);
    };
    const onWheel = (event) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.0022, 2.15, 4.5);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    let disposed = false;
    const animate = () => {
      if (disposed) return;
      frame += 1;
      if (!drag.active) globeGroup.rotation.y += 0.0018;
      nodeMeshes.forEach((mesh, index) => {
        const pulse = 1 + Math.sin(frame * 0.045 + index * 0.31) * 0.16;
        mesh.scale.setScalar((mesh.userData.lifted ? 1.32 : 1) * (mesh.userData.chinaFocus ? 1.26 : 1) * pulse);
      });
      labelSprites.forEach((sprite) => {
        sprite.quaternion.copy(camera.quaternion);
      });
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      renderer.dispose();
      earthTexture.dispose();
      earth.geometry.dispose();
      earth.material.dispose();
      atmosphere.geometry.dispose();
      atmosphere.material.dispose();
      nodeGeometry.dispose();
      anchorGeometry.dispose();
      satelliteLineMaterial.dispose();
      labelSprites.forEach((sprite) => {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      });
    };
  }, [globeNodes]);

  return (
    <div ref={mountRef} className="lab-globe-graph">
      <canvas ref={canvasRef} aria-label="三维地球金融资讯图谱" />
      <div className="lab-globe-meta">
        <span>{globeNodes.length} 资讯节点</span>
        <span>中国 {chinaNodeCount}</span>
        <span>密集地区自动外扩</span>
      </div>
      {tooltip && (
        <div className="lab-globe-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
          <strong>{tooltip.title}</strong>
          <span>{tooltip.source} · {tooltip.location || "资讯发生地"} · 影响 {tooltip.related}</span>
        </div>
      )}
    </div>
  );
}

export function FinancialIntelligenceLab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("global");
  const [categoryIds, setCategoryIds] = useState([]);
  const [managedAssetIds, setManagedAssetIds] = useState([]);
  const [assetToAdd, setAssetToAdd] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [selectedNews, setSelectedNews] = useState(null);
  const [question, setQuestion] = useState("如果霍尔木兹海峡风险继续升温，未来一周全球资产会如何传导？");
  const [simulation, setSimulation] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [processLines, setProcessLines] = useState([]);
  const [activeGraphFocus, setActiveGraphFocus] = useState(null);
  const [graphViewMode, setGraphViewMode] = useState("2d");
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [windows, setWindows] = useState({
    ask: true,
    graph: true
  });
  const [windowOffsets, setWindowOffsets] = useState({
    ask: { x: 0, y: 0 },
    graph: { x: 0, y: 0 }
  });
  const [activeWindow, setActiveWindow] = useState("ask");
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState(() => ({
    provider: "deepseek",
    api_kind: "openai",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    api_key: "",
    ...(readAnyStoredModelConfig() || {})
  }));
  const playbackTimersRef = useRef([]);

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true);
    const response = await fetch(`/api/financial-intel-lab${force ? "?refresh=1" : ""}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "加载失败");
    setData(payload);
    setCategoryIds((current) => current.length ? current.filter((id) => !hiddenCategoryIds.has(id)) : payload.newsCategories.filter((item) => !hiddenCategoryIds.has(item.id)).map((item) => item.id));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load(false).catch(() => setLoading(false));
  }, [load]);

  const availableCategories = useMemo(() => (data?.newsCategories || []).filter((category) => !hiddenCategoryIds.has(category.id)), [data]);

  const assets = useMemo(() => {
    const nodes = data?.marketData?.nodes || [];
    return nodes.filter((node) => {
      if (node.type === "hub") return false;
      const typeOk = assetFilter === "all" || node.type === assetFilter;
      const regionOk = regionMatch(node, regionFilter);
      return typeOk && regionOk && tabMatch(activeTab, node);
    }).sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0));
  }, [data, activeTab, assetFilter, regionFilter]);

  useEffect(() => {
    if (!assets.length) return;
    setManagedAssetIds((current) => {
      const valid = current.filter((id) => assets.some((asset) => asset.id === id));
      return valid.length ? valid : assets.slice(0, 5).map((asset) => asset.id);
    });
  }, [assets]);

  const displayedAssets = useMemo(() => managedAssetIds.map((id) => assets.find((asset) => asset.id === id)).filter(Boolean), [assets, managedAssetIds]);
  const addableAssets = useMemo(() => assets.filter((asset) => !managedAssetIds.includes(asset.id)), [assets, managedAssetIds]);

  const news = useMemo(() => {
    const selected = new Set(categoryIds);
    return (data?.financialGraph?.news || []).filter((item) => selected.has(item.category)).slice(0, 360);
  }, [data, categoryIds]);

  const graphMapOverlay = useMemo(
    () => buildMapGraphOverlay(data?.financialGraph, data?.marketData, categoryIds),
    [data, categoryIds]
  );

  useEffect(() => () => {
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const playSimulation = useCallback((payload) => {
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playbackTimersRef.current = [];
    setProcessLines([]);
    setActiveGraphFocus(null);
    const events = buildSimulationPlaybackEvents(payload);
    let delay = 0;
    events.forEach((item) => {
      const timer = window.setTimeout(() => {
        setProcessLines((current) => [...current, item.line]);
        setActiveGraphFocus(item.focus?.nodeIds?.length || item.focus?.edgeIds?.length ? item.focus : null);
      }, delay);
      playbackTimersRef.current.push(timer);
      delay += item.focus ? 1500 : 520;
    });
    const endTimer = window.setTimeout(() => {
      setActiveGraphFocus(null);
      setSimulating(false);
    }, delay + 900);
    playbackTimersRef.current.push(endTimer);
  }, []);

  const runSimulation = async (event) => {
    event.preventDefault();
    if (!question.trim()) return;
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playbackTimersRef.current = [];
    setSimulating(true);
    setSimulation(null);
    setActiveGraphFocus(buildAmbientGraphFocus(graphMapOverlay, 0));
    setProcessLines([
      "读取 news 目录与 RSS 快照，筛选当前勾选的资讯主题。",
      "抽取资产、区域、实体和事件，重新编织金融图谱。",
      "根据当前金融图谱生成讨论角色，并提交给 MiroFish LLMClient。"
    ]);
    const timers = [
      window.setTimeout(() => setProcessLines((current) => [...current, "第1轮准备：各角色读取证据并提出初始判断。"]), 420),
      window.setTimeout(() => setProcessLines((current) => [...current, "第2轮准备：角色交叉质询资产、区域和流动性传导。"]), 980),
      window.setTimeout(() => setProcessLines((current) => [...current, "第3轮准备：角色收敛分歧，形成最终结论。"]), 1540),
      window.setTimeout(() => setProcessLines((current) => [...current, "MiroFish Runtime: 正在生成智能体人设，等待 LLM 返回。"]), 4200),
      window.setTimeout(() => setActiveGraphFocus(buildAmbientGraphFocus(graphMapOverlay, 28)), 5200),
      window.setTimeout(() => setProcessLines((current) => [...current, "MiroFish Runtime: 正在推进多轮角色发言，节点和边会随发言闪烁。"]), 11000),
      window.setTimeout(() => setActiveGraphFocus(buildAmbientGraphFocus(graphMapOverlay, 62)), 12600),
      window.setTimeout(() => setProcessLines((current) => [...current, "MiroFish Runtime: 多智能体推演仍在运行，正在等待轮次总结。"]), 24000),
      window.setTimeout(() => setActiveGraphFocus(buildAmbientGraphFocus(graphMapOverlay, 104)), 25600),
      window.setTimeout(() => setProcessLines((current) => [...current, "MiroFish Runtime: 仍在等待最终协调者结论；70秒内会返回结果或明确错误。"]), 45000)
    ];

    try {
      const controller = new AbortController();
      const requestTimer = window.setTimeout(() => controller.abort(), 85000);
      const response = await fetch("/api/mirofish-simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          selectedCategories: categoryIds,
          modelConfig: readStoredModelConfig()
        })
      });
      window.clearTimeout(requestTimer);
      const payload = await response.json();
      if (!response.ok) {
        const message = payload.detail || payload.error || "推演失败";
        if (payload.partial) {
          setSimulation(payload.partial);
          const roleLine = payload.partial.roles?.length
            ? `角色生成: ${payload.partial.roles.map((role) => `${role.name}（${role.stance}）`).join("、")}`
            : "角色生成: 金融图谱未返回角色。";
          const stageLines = (payload.partial.stages || []).map((stage) => `${stage.name}: ${stage.detail}`);
          setProcessLines((current) => [
            ...current,
            ...stageLines,
            roleLine,
            `MiroFish Runtime: 已提交到 MiroFish LLMClient，但真实 LLM 调用失败。`,
            `推演中断: ${message}`
          ]);
        } else {
          setProcessLines((current) => [...current, `推演中断: ${message}`]);
        }
        setActiveGraphFocus(null);
        setSimulating(false);
        return;
      }
      setSimulation(payload);
      playSimulation(payload);
      setWindows((current) => ({ ...current, ask: true }));
    } catch (error) {
      const message = error.name === "AbortError"
        ? "请求超时：MiroFish/DeepSeek 在 85 秒内没有返回，请检查 API 网络或稍后重试。"
        : error.message;
      setProcessLines((current) => [...current, `推演中断: ${message}`]);
      setActiveGraphFocus(null);
      setSimulating(false);
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
    }
  };

  const toggleCategory = (id) => {
    setCategoryIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const addAsset = () => {
    const nextId = assetToAdd || addableAssets[0]?.id;
    if (!nextId) return;
    setManagedAssetIds((current) => current.includes(nextId) ? current : [...current, nextId]);
    setAssetToAdd("");
  };

  const removeAsset = (id) => {
    setManagedAssetIds((current) => current.filter((item) => item !== id));
    if (selectedAsset?.id === id) setSelectedAsset(null);
  };

  const hideWindow = (id) => setWindows((current) => ({ ...current, [id]: false }));
  const showWindow = (id) => setWindows((current) => ({ ...current, [id]: true }));
  const moveWindow = (id, offset) => {
    setWindowOffsets((current) => ({ ...current, [id]: offset }));
  };

  const saveModelConfig = () => {
    window.localStorage.setItem("finterraModelConfig", JSON.stringify({
      ...modelConfig,
      enabled: true,
      tested: true
    }));
    setModelConfig((current) => ({ ...current, enabled: true, tested: true }));
    setShowModelSettings(false);
    setProcessLines((current) => [...current, `模型配置: 已保存 ${modelConfig.model || "LLM"}。`]);
  };

  if (loading && !data) {
    return (
      <main className="market-cockpit">
        <SiteTopNav />
        <section className="loading-state cockpit-loading">
          <div className="loader" />
          <h2>正在构建金融资讯推演实验室……</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="market-cockpit lab-page">
      <SiteTopNav />
      <div className="lab-shell">
        <aside className="lab-sidebar">
          <header className="cockpit-header">
            <p className="site-kicker">MIROFISH FINANCIAL SANDBOX</p>
            <h1>全球金融资讯推演实验室</h1>
            <p>从 news 目录读取真实资讯，构建金融图谱，再用 MiroFish 式多对象推演回答你的问题。</p>
          </header>

          <div className="graph-tabs">
            {Object.entries(tabLabels).map(([key, label]) => (
              <button key={key} className={activeTab === key ? "active" : ""} type="button" onClick={() => setActiveTab(key)}>{label}</button>
            ))}
          </div>

          <div className="graph-select-grid">
            <label>
              <span>资产类型</span>
              <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
                {Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>区域</span>
              <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
                {Object.entries(regionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          </div>

          <button className="refresh-button cockpit-refresh" type="button" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? "spinning" : ""} />
            {refreshing ? "刷新中" : "刷新 news 与图谱"}
          </button>

          <section className="lab-category-panel">
            <div className="asset-list-head">
              <strong>资讯内容</strong>
              <span>{categoryIds.length}/{availableCategories.length}</span>
            </div>
            <div className="lab-category-grid">
              {availableCategories.map((category) => (
                <button key={category.id} type="button" className={categoryIds.includes(category.id) ? "checked" : ""} onClick={() => toggleCategory(category.id)}>
                  {categoryIds.includes(category.id) ? <CheckSquare size={13} /> : <Square size={13} />}
                  <span>{category.label}</span>
                  <em>{category.count}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="intel-panel">
            <div className="intel-panel-head">
              <span><Newspaper size={15} />金融资讯</span>
              <strong>{news.length}</strong>
            </div>
            <div className="intel-news-list">
              {news.slice(0, 10).map((item) => (
                <button key={item.id} className={selectedNews?.id === item.id ? "intel-news-row active" : "intel-news-row"} type="button" onClick={() => { setSelectedNews(item); setSelectedAsset(null); }}>
                  <span className={`intel-dot ${eventToneClass(item)}`} />
                  <strong>{item.title}</strong>
                  <small>{item.source} · {item.locationLabel || item.relatedLabel} · {formatTime(item.publishedAt)}</small>
                </button>
              ))}
            </div>
          </section>

          <div className="asset-list-head">
            <strong>全部资产</strong>
            <span>{displayedAssets.length}/{assets.length} 个节点</span>
          </div>
          <div className="lab-asset-manager">
            <select value={assetToAdd} onChange={(event) => setAssetToAdd(event.target.value)} disabled={!addableAssets.length}>
              <option value="">选择要添加的资产</option>
              {addableAssets.map((node) => (
                <option key={node.id} value={node.id}>{node.label} · {node.symbol || node.id}</option>
              ))}
            </select>
            <button type="button" onClick={addAsset} disabled={!addableAssets.length}>
              <Plus size={14} />
              添加
            </button>
          </div>
          <div className="market-node-list cockpit-node-list">
            {displayedAssets.map((node) => (
              <div key={node.id} className={selectedAsset?.id === node.id ? "market-node-row lab-managed-asset active" : "market-node-row lab-managed-asset"}>
                <button type="button" onClick={() => { setSelectedAsset(node); setSelectedNews(null); }}>
                  <span>
                    <strong>{node.label}</strong>
                    <small>{node.symbol || node.id} · {node.country || node.region}</small>
                  </span>
                  <em className={Number(node.changePct || 0) >= 0 ? "up" : "down"}>{formatChange(node.changePct)}</em>
                </button>
                <button type="button" className="lab-remove-asset" onClick={() => removeAsset(node.id)} title="删除资产">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="lab-map-area">
          <div className="map-overlay stats-bar lab-stats">
            <div className="stat-item"><span>news 目录</span><strong>{data?.financialGraph?.summary.newsCount || 0}</strong></div>
            <div className="stat-item"><span>图谱节点</span><strong>{data?.financialGraph?.summary.graphNodeCount || 0}</strong></div>
            <div className="stat-item"><span>图谱关系</span><strong>{data?.financialGraph?.summary.graphEdgeCount || 0}</strong></div>
          </div>
          <div className="map-overlay update-panel lab-update-panel">
            <button type="button" onClick={() => document.querySelector(".lab-map-actions button")?.click()}>
              <RotateCcw size={15} />
              全球视图
            </button>
            <span>最后刷新: <strong>{formatTime(data?.generatedAt)}</strong></span>
          </div>

          <IntelMap
            assets={displayedAssets}
            news={news}
            graphOverlay={simulating || activeGraphFocus ? graphMapOverlay : null}
            activeGraphFocus={activeGraphFocus}
            selectedAssetId={selectedAsset?.id}
            selectedNewsId={selectedNews?.id}
            onAssetSelect={(node) => { setSelectedAsset(node); setSelectedNews(null); }}
            onNewsSelect={(item) => { setSelectedNews(item); setSelectedAsset(null); }}
          />

          <div className="lab-window-restore">
            {Object.entries({ ask: "提问", graph: "金融图谱" }).map(([id, label]) => (
              <button key={id} type="button" className={windows[id] ? "active" : ""} onClick={() => windows[id] ? hideWindow(id) : showWindow(id)}>
                {windows[id] ? <Eye size={13} /> : <EyeOff size={13} />}
                {label}
              </button>
            ))}
            <button type="button" className={showAgentPanel ? "active" : ""} onClick={() => setShowAgentPanel((value) => !value)}>
              <Bot size={13} />
              Agent
            </button>
          </div>

          <div className="lab-floating-stack">
            <FloatingWindow
              id="ask"
              title="向FinTerra提问"
              icon={CircleHelp}
              visible={windows.ask}
              onHide={hideWindow}
              dragOffset={windowOffsets.ask}
              active={activeWindow === "ask"}
              onMove={moveWindow}
              onFocus={setActiveWindow}
            >
              <form className="lab-question-form" onSubmit={runSimulation}>
                <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
                <button type="submit" disabled={simulating} aria-label={simulating ? "正在推演" : "提交问题"} title={simulating ? "正在推演" : "提交问题"}>
                  <Send size={15} />
                </button>
              </form>
              <div className="lab-model-bar">
                <button type="button" onClick={() => setShowModelSettings((value) => !value)}>
                  <KeyRound size={13} />
                  模型
                </button>
                <span className={readStoredModelConfig() ? "ready" : "missing"}>
                  {readStoredModelConfig()?.model || "服务器 .env"}
                </span>
              </div>
              {showModelSettings && (
                <div className="lab-model-settings">
                  <label>
                    <span>API Key</span>
                    <input
                      type="password"
                      value={modelConfig.api_key || ""}
                      onChange={(event) => setModelConfig((current) => ({ ...current, api_key: event.target.value }))}
                      placeholder="sk-..."
                    />
                  </label>
                  <label>
                    <span>Base URL</span>
                    <input
                      value={modelConfig.base_url || ""}
                      onChange={(event) => setModelConfig((current) => ({ ...current, base_url: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Model</span>
                    <input
                      value={modelConfig.model || ""}
                      onChange={(event) => setModelConfig((current) => ({ ...current, model: event.target.value }))}
                    />
                  </label>
                  <button type="button" onClick={saveModelConfig}>
                    保存模型
                  </button>
                </div>
              )}
              <div className="lab-process-stream" aria-live="polite">
                {(processLines.length ? processLines : ["提交问题后，这里会实时显示角色生成、三轮讨论、每轮总结和最终结论。"]).map((line, index) => (
                  <p
                    key={`${line}-${index}`}
                    className={line.startsWith("最终结论") ? "result" : line.includes("轮总结") ? "round-summary" : line.includes("轮讨论") ? "round-title" : ""}
                  >
                    {line}
                  </p>
                ))}
              </div>
              {simulation && !simulating && (
                <>
                  <div className="lab-evidence-list lab-merged-evidence">
                    <div className="lab-evidence-title">推演证据</div>
                    {(simulation.evidence || []).slice(0, 10).map((item) => (
                      <article key={item.id}>
                        <strong>{item.title}</strong>
                        <span>{item.source} · {item.locationLabel || item.relatedLabel || item.category}</span>
                      </article>
                    ))}
                  </div>
                  <div className="lab-disclaimer" role="note">
                    免责提醒：以上推演基于当前 news 目录、公开行情和本地图谱关系生成，仅用于研究和情景分析，不构成投资建议、交易指令或收益承诺。市场存在延迟、缺失和突发变化，请结合自身风险承受能力独立判断。
                  </div>
                  <div className="lab-premium-report">
                    <div>
                      <strong>完整推演报告下载</strong>
                      <span>在线查看免费；导出 PDF、复制完整证据链、下载研究包进入 Pro。</span>
                    </div>
                    <a href="/model-api/?intent=mirofish-report-download">
                      <Download size={14} />
                      下载报告
                    </a>
                  </div>
                </>
              )}
            </FloatingWindow>

            <FloatingWindow
              id="graph"
              title="金融图谱"
              icon={Network}
              visible={windows.graph}
              onHide={hideWindow}
              className={`lab-graph-window ${graphViewMode === "3d" ? "lab-graph-window-3d" : ""}`}
              headerAction={(
                <div className="lab-graph-mode-tabs" role="tablist" aria-label="金融图谱显示模式">
                  <button type="button" className={graphViewMode === "2d" ? "active" : ""} onClick={() => setGraphViewMode("2d")}>二维</button>
                  <button type="button" className={graphViewMode === "3d" ? "active" : ""} onClick={() => setGraphViewMode("3d")}>三维</button>
                </div>
              )}
              dragOffset={windowOffsets.graph}
              active={activeWindow === "graph"}
              onMove={moveWindow}
              onFocus={setActiveWindow}
            >
              {graphViewMode === "2d" ? (
                <FinancialGraph graph={simulation?.graph || data?.financialGraph} activeGraphFocus={activeGraphFocus} />
              ) : (
                <GlobeFinancialGraph graph={simulation?.graph || data?.financialGraph} />
              )}
            </FloatingWindow>

            {showAgentPanel && (
              <section className="lab-float-window lab-agent-window">
                <div className="lab-window-head">
                  <span><Bot size={16} />金融 Agent 协同台</span>
                  <button type="button" onClick={() => setShowAgentPanel(false)}><EyeOff size={14} /></button>
                </div>
                <p className="muted-copy">此面板默认隐藏。后续接入 Anthropic financial-services 的正式 MCP 凭证后，可把 Pitch Agent、Market Researcher、Earnings Reviewer 等任务接入这里。</p>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
