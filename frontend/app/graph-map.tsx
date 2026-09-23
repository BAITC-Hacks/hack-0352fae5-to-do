"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MoneyGraph, MoneyNode } from "@/lib/money-data";
import type { Language } from "@/app/workbench";

export type GraphViewMode = "network" | "connections" | "cluster";
type GraphNode = MoneyGraph["nodes"][number] & { px: number; py: number };
type GraphEdge = MoneyGraph["edges"][number];
type Camera = { scale: number; x: number; y: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; camera: Camera; moved: boolean }
  | { kind: "node"; gid: string; moved: boolean };

const priorityColor = (score: number) =>
  score >= 0.85 ? "#d64545" : score >= 0.7 ? "#ea7a32" : score >= 0.5 ? "#e7b52c" : score >= 0.25 ? "#a8b83a" : "#35a65a";

const COPY = {
  ru: {
    hint: "Наведите на счёт, чтобы выделить его связи · нажмите, чтобы выбрать",
    full: "На весь экран",
    exit: "Выйти",
    fit: "Вписать",
    incoming: "Входящих",
    outgoing: "Исходящих",
    priority: "Приоритет",
    cluster: "Кластер",
    localEmpty: "Выберите счёт — здесь появятся только его прямые связи",
    move: "Узел можно перетащить · двойной клик вернёт его на место",
  },
  en: {
    hint: "Hover to highlight links · click to select an account",
    full: "Fullscreen",
    exit: "Exit",
    fit: "Fit",
    incoming: "Incoming",
    outgoing: "Outgoing",
    priority: "Priority",
    cluster: "Cluster",
    localEmpty: "Select an account to see only its direct links",
    move: "Drag a node · double-click restores its position",
  },
} as const;

function localLayout(selectedGid: string, graph: MoneyGraph): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const incident = graph.edges.filter((edge) => edge.src === selectedGid || edge.dst === selectedGid);
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of incident) {
    if (edge.dst === selectedGid) incoming.set(edge.src, (incoming.get(edge.src) ?? 0) + edge.sum_kzt);
    if (edge.src === selectedGid) outgoing.set(edge.dst, (outgoing.get(edge.dst) ?? 0) + edge.sum_kzt);
  }
  const left = [...incoming].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const right = [...outgoing]
    .filter(([gid]) => !incoming.has(gid))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const base = new Map(graph.nodes.map((node) => [node.gid, node]));
  const positions = new Map<string, { x: number; y: number }>([[selectedGid, { x: 0, y: 0 }]]);

  function place(items: [string, number][], direction: -1 | 1) {
    const rows = 14;
    items.forEach(([gid], index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const inLastColumn = Math.min(rows, items.length - column * rows);
      positions.set(gid, {
        x: direction * (260 + column * 150),
        y: (row - (inLastColumn - 1) / 2) * 48 + (column % 2 ? 18 : 0),
      });
    });
  }
  place(left, -1);
  place(right, 1);

  const nodes = [...positions].flatMap(([gid, point]) => {
    const node = base.get(gid);
    return node ? [{ ...node, px: point.x, py: point.y }] : [];
  });
  return { nodes, edges: incident };
}

function staticLayout(
  graph: MoneyGraph,
  mode: Exclude<GraphViewMode, "connections">,
  selectedGid: string | null,
  details: Map<string, MoneyNode>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const selectedCluster = selectedGid ? details.get(selectedGid)?.cluster_id : undefined;
  const source = mode === "cluster" && selectedCluster !== undefined
    ? graph.nodes.filter((node) => node.cluster_id === selectedCluster)
    : graph.nodes;
  const ids = new Set(source.map((node) => node.gid));
  const edges = graph.edges.filter((edge) => ids.has(edge.src) && ids.has(edge.dst));
  const spread = mode === "cluster" ? 180 : 230;
  return { nodes: source.map((node) => ({ ...node, px: node.x * spread, py: node.y * spread })), edges };
}

export function GraphMap({ graph, nodeDetails, selectedGid, focusToken, mode, roleFilter, onSelect, language }: {
  graph: MoneyGraph;
  nodeDetails: Map<string, MoneyNode>;
  selectedGid: string | null;
  focusToken: number;
  mode: GraphViewMode;
  roleFilter: string;
  onSelect: (gid: string) => void;
  language: Language;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overridesRef = useRef(new Map<string, { x: number; y: number }>());
  const interactionRef = useRef<Drag | null>(null);
  const cameraRef = useRef<Camera>({ scale: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ scale: 1, x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const t = COPY[language];

  const view = useMemo(() => {
    if (mode === "connections" && selectedGid) return localLayout(selectedGid, graph);
    if (mode === "connections") return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    return staticLayout(graph, mode, selectedGid, nodeDetails);
  }, [graph, mode, selectedGid, nodeDetails]);
  const viewIds = useMemo(() => new Set(view.nodes.map((node) => node.gid)), [view.nodes]);
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of view.nodes) map.set(node.gid, new Set());
    for (const edge of view.edges) {
      map.get(edge.src)?.add(edge.dst);
      map.get(edge.dst)?.add(edge.src);
    }
    return map;
  }, [view]);
  const edgeCounts = useMemo(() => {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const edge of graph.edges) {
      incoming.set(edge.dst, (incoming.get(edge.dst) ?? 0) + 1);
      outgoing.set(edge.src, (outgoing.get(edge.src) ?? 0) + 1);
    }
    return { incoming, outgoing };
  }, [graph.edges]);

  const position = useCallback((node: GraphNode) => overridesRef.current.get(node.gid) ?? { x: node.px, y: node.py }, []);
  const fit = useCallback(() => {
    if (!view.nodes.length || !size.width || !size.height) return;
    const points = view.nodes.map(position);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const margin = mode === "connections" ? 90 : 70;
    const scale = Math.min((size.width - margin * 2) / Math.max(100, maxX - minX), (size.height - margin * 2) / Math.max(100, maxY - minY));
    const next = {
      scale: Math.max(0.035, Math.min(mode === "connections" ? 1.7 : 3.5, scale)),
      x: size.width / 2 - ((minX + maxX) / 2) * scale,
      y: size.height / 2 - ((minY + maxY) / 2) * scale,
    };
    cameraRef.current = next;
    setCamera(next);
  }, [mode, position, size, view.nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const handler = () => setFullscreen(document.fullscreenElement === sectionRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  useEffect(() => {
    overridesRef.current.clear();
    const frame = requestAnimationFrame(() => {
      setHovered(null);
      fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [fit, focusToken, mode, selectedGid]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.round(size.width * ratio);
    const pixelHeight = Math.round(size.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#fbfcfb";
    context.fillRect(0, 0, size.width, size.height);
    const nodeById = new Map(view.nodes.map((node) => [node.gid, node]));
    const hoverNeighbors = hovered ? neighbors.get(hovered) : undefined;
    const point = (node: GraphNode) => {
      const p = position(node);
      return { x: p.x * camera.scale + camera.x, y: p.y * camera.scale + camera.y };
    };

    for (const edge of view.edges) {
      const source = nodeById.get(edge.src);
      const target = nodeById.get(edge.dst);
      if (!source || !target) continue;
      const a = point(source);
      const b = point(target);
      const highlighted = Boolean(hovered && (edge.src === hovered || edge.dst === hovered));
      const selectedEdge = Boolean(selectedGid && (edge.src === selectedGid || edge.dst === selectedGid));
      context.globalAlpha = hovered ? (highlighted ? 0.92 : 0.035) : mode === "connections" ? 0.7 : selectedEdge ? 0.5 : 0.075;
      context.strokeStyle = selectedGid && edge.dst === selectedGid ? "#3077a8" : selectedGid && edge.src === selectedGid ? "#7255b8" : "#718086";
      context.lineWidth = 0.7 + Math.min(2.3, Math.log10(Math.max(10, edge.sum_kzt)) / 4);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lane = [...`${edge.src}:${edge.dst}`].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9 - 4;
      const bend = mode === "connections" ? (dy >= 0 ? 1 : -1) * (14 + Math.abs(lane) * 3) : lane * 2.5;
      const control1 = { x: a.x + dx * 0.34, y: a.y + dy * 0.14 + bend };
      const control2 = { x: a.x + dx * 0.68, y: b.y - dy * 0.14 + bend };
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, b.x, b.y);
      context.stroke();
      if (highlighted || (mode === "connections" && selectedEdge)) {
        const tangentX = b.x - control2.x;
        const tangentY = b.y - control2.y;
        const length = Math.hypot(tangentX, tangentY);
        if (length > 10) {
          const ux = tangentX / length;
          const uy = tangentY / length;
          const x = b.x - ux * 9;
          const y = b.y - uy * 9;
          context.fillStyle = context.strokeStyle;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - ux * 7 - uy * 3.5, y - uy * 7 + ux * 3.5);
          context.lineTo(x - ux * 7 + uy * 3.5, y - uy * 7 - ux * 3.5);
          context.fill();
        }
      }
    }

    for (const node of view.nodes) {
      const p = point(node);
      if (p.x < -24 || p.y < -24 || p.x > size.width + 24 || p.y > size.height + 24) continue;
      const selected = node.gid === selectedGid;
      const hover = node.gid === hovered;
      const connected = !hovered || hover || hoverNeighbors?.has(node.gid);
      const roleActive = roleFilter === "all" || node.role === roleFilter;
      context.globalAlpha = selected || hover ? 1 : connected && roleActive ? 0.9 : 0.08;
      const zoomRadius = Math.min(1.9, Math.max(0.9, Math.sqrt(camera.scale / 0.45)));
      const radius = (selected ? 8.5 : hover ? 7.5 : 4 + node.priority_score * 4) * zoomRadius;
      context.fillStyle = priorityColor(node.priority_score);
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fill();
      if (node.is_seed || selected || hover) {
        context.strokeStyle = selected ? "#142126" : "#52636a";
        context.lineWidth = selected ? 2.6 : 1.3;
        context.beginPath();
        context.arc(p.x, p.y, radius + 3.5, 0, Math.PI * 2);
        context.stroke();
      }
      if ((selected || hover) && camera.scale > 0.12) {
        context.globalAlpha = 1;
        context.fillStyle = "#172126";
        context.font = "600 12px ui-monospace, monospace";
        context.fillText(node.gid, p.x + radius + 8, p.y - radius - 2);
      }
    }
    context.globalAlpha = 1;
  }, [camera, hovered, mode, neighbors, position, roleFilter, selectedGid, size, view]);

  useEffect(draw, [draw, layoutVersion]);

  const nearest = useCallback((screenX: number, screenY: number, maximum = 18) => {
    let result: GraphNode | undefined;
    let best = maximum * maximum;
    for (const node of view.nodes) {
      const p = position(node);
      const dx = p.x * cameraRef.current.scale + cameraRef.current.x - screenX;
      const dy = p.y * cameraRef.current.scale + cameraRef.current.y - screenY;
      const distance = dx * dx + dy * dy;
      if (distance < best) { best = distance; result = node; }
    }
    return result;
  }, [position, view.nodes]);
  const zoom = useCallback((factor: number, cx = size.width / 2, cy = size.height / 2) => {
    setCamera((current) => {
      const scale = Math.max(0.025, Math.min(20, current.scale * factor));
      const ratio = scale / current.scale;
      const next = { scale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
      cameraRef.current = next;
      return next;
    });
  }, [size]);
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await sectionRef.current?.requestFullscreen();
  }

  const hoveredDetail = hovered ? nodeDetails.get(hovered) : null;
  return (
    <section ref={sectionRef} className={`live-graph ${fullscreen ? "is-fullscreen" : ""}`}>
      <div className="graph-controls">
        <div><button onClick={() => zoom(1.6)}>+</button><button onClick={() => zoom(1 / 1.6)}>−</button><button onClick={fit}>{t.fit}</button></div>
        <span>{t.hint}</span>
        <button onClick={toggleFullscreen}>{fullscreen ? t.exit : `⛶ ${t.full}`}</button>
      </div>
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          onWheel={(event) => {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const y = event.clientY - bounds.top;
            const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * size.height : event.deltaY;
            const normalized = Math.max(-180, Math.min(180, pixels));
            zoom(Math.exp(-normalized * 0.0035), x, y);
          }}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const y = event.clientY - bounds.top;
            const node = nearest(x, y);
            event.currentTarget.setPointerCapture(event.pointerId);
            interactionRef.current = node ? { kind: "node", gid: node.gid, moved: false } : { kind: "pan", sx: x, sy: y, camera: cameraRef.current, moved: false };
          }}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const y = event.clientY - bounds.top;
            const drag = interactionRef.current;
            if (!drag) { setHovered(nearest(x, y)?.gid ?? null); return; }
            if (drag.kind === "node") {
              drag.moved = true;
              overridesRef.current.set(drag.gid, { x: (x - cameraRef.current.x) / cameraRef.current.scale, y: (y - cameraRef.current.y) / cameraRef.current.scale });
              setLayoutVersion((value) => value + 1);
            } else {
              const dx = x - drag.sx;
              const dy = y - drag.sy;
              if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
              const next = { ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy };
              cameraRef.current = next;
              setCamera(next);
            }
          }}
          onPointerUp={() => {
            const drag = interactionRef.current;
            interactionRef.current = null;
            if (drag?.kind === "node" && !drag.moved) onSelect(drag.gid);
          }}
          onDoubleClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const node = nearest(event.clientX - bounds.left, event.clientY - bounds.top);
            if (node) { overridesRef.current.delete(node.gid); setLayoutVersion((value) => value + 1); }
          }}
          onPointerLeave={() => setHovered(null)}
        />
        {!viewIds.size && <div className="graph-empty">{t.localEmpty}</div>}
        {hoveredDetail && <div className="vertex-tooltip"><strong>{hoveredDetail.gid}</strong><div><span style={{ background: priorityColor(hoveredDetail.priority_score) }} />{t.priority} {hoveredDetail.priority_score.toFixed(3)}</div><dl><dt>{t.incoming}</dt><dd>{edgeCounts.incoming.get(hoveredDetail.gid) ?? 0}</dd><dt>{t.outgoing}</dt><dd>{edgeCounts.outgoing.get(hoveredDetail.gid) ?? 0}</dd><dt>{t.cluster}</dt><dd>#{hoveredDetail.cluster_id}</dd></dl><small>{t.move}</small></div>}
      </div>
      <div className="priority-legend"><span>0</span><i /><span>1.0</span><small>{t.priority}</small></div>
    </section>
  );
}
