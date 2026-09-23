"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MoneyGraph } from "@/lib/money-data";

type Camera = { scale: number; offsetX: number; offsetY: number };
type MapSize = { width: number; height: number };

const ROLE_COLOR: Record<string, string> = {
  consolidator: "#10a58c",
  coordinator: "#628ee6",
  distributor: "#d29a48",
  transit: "#8b72c9",
  terminal: "#a8b883",
  peripheral: "#a6b8bc",
};
const INCOMING = "#327bd2";
const OUTGOING = "#d78827";

export function GraphMap({
  graph,
  selectedGid,
  focusToken,
  roleFilter,
  clusterFilter,
  onSelect,
}: {
  graph: MoneyGraph;
  selectedGid: string | null;
  focusToken: number;
  roleFilter: string;
  clusterFilter: number | null;
  onSelect: (gid: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const [size, setSize] = useState<MapSize>({ width: 0, height: 0 });
  const [cameraOverride, setCameraOverride] = useState<{ key: string; camera: Camera } | null>(null);
  const byGid = useMemo(() => new Map(graph.nodes.map((node) => [node.gid, node])), [graph.nodes]);
  const bounds = useMemo(() => {
    const xs = graph.nodes.map((node) => node.x);
    const ys = graph.nodes.map((node) => node.y);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }, [graph.nodes]);
  const maxAmount = useMemo(() => Math.max(1, ...graph.edges.map((edge) => edge.sum_kzt)), [graph.edges]);
  const linked = useMemo(() => {
    const neighbors = new Set<string>();
    const incoming: MoneyGraph["edges"] = [];
    const outgoing: MoneyGraph["edges"] = [];
    if (selectedGid) {
      for (const edge of graph.edges) {
        if (edge.dst === selectedGid) { incoming.push(edge); neighbors.add(edge.src); }
        if (edge.src === selectedGid) { outgoing.push(edge); neighbors.add(edge.dst); }
      }
    }
    return { neighbors, incoming, outgoing };
  }, [graph.edges, selectedGid]);

  const fittedCamera = useCallback((width = size.width, height = size.height): Camera => {
    if (!width || !height) return { scale: 1, offsetX: 0, offsetY: 0 };
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min((width - 52) / spanX, (height - 52) / spanY);
    return {
      scale,
      offsetX: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      offsetY: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    };
  }, [bounds, size.width, size.height]);

  const focusKey = `${selectedGid ?? ""}:${focusToken}:${size.width}:${size.height}`;
  const baseCamera = useMemo(() => {
    const focusedNode = selectedGid ? byGid.get(selectedGid) : null;
    if (!focusedNode) return fittedCamera();
    const distances = [...linked.neighbors].map((gid) => byGid.get(gid)).filter((node) => node !== undefined)
      .map((node) => Math.hypot(node.x - focusedNode.x, node.y - focusedNode.y)).sort((a, b) => a - b);
    const radius = distances[Math.floor(distances.length * 0.9)] ?? 0;
    const scale = Math.min(1200, Math.max(350, radius ? size.height * 0.34 / radius : 700));
    return { scale, offsetX: size.width / 2 - focusedNode.x * scale,
      offsetY: size.height / 2 - focusedNode.y * scale };
  }, [selectedGid, byGid, fittedCamera, linked.neighbors, size.width, size.height]);
  const camera = cameraOverride?.key === focusKey ? cameraOverride.camera : baseCamera;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frame = requestAnimationFrame(() => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.fillStyle = "#fbfdfc";
      ctx.fillRect(0, 0, size.width, size.height);
      const point = (node: MoneyGraph["nodes"][number]) => ({
        x: node.x * camera.scale + camera.offsetX,
        y: node.y * camera.scale + camera.offsetY,
      });
      const drawEdge = (edge: MoneyGraph["edges"][number], color: string, alpha: number, extraWidth = 0) => {
        const source = byGid.get(edge.src);
        const target = byGid.get(edge.dst);
        if (!source || !target) return;
        const a = point(source);
        const b = point(target);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < 3) return;
        const ux = dx / length;
        const uy = dy / length;
        const endX = b.x - ux * (extraWidth ? 8 : 4);
        const endY = b.y - uy * (extraWidth ? 8 : 4);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 0.45 + Math.log1p(edge.sum_kzt) / Math.log1p(maxAmount) * 1.4 + extraWidth;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        const arrow = extraWidth ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - ux * arrow - uy * arrow * 0.55, endY - uy * arrow + ux * arrow * 0.55);
        ctx.lineTo(endX - ux * arrow + uy * arrow * 0.55, endY - uy * arrow - ux * arrow * 0.55);
        ctx.closePath();
        ctx.fill();
      };

      for (const edge of graph.edges) drawEdge(edge, "#708c91", selectedGid ? 0.025 : 0.16);
      if (selectedGid) {
        for (const edge of linked.incoming) drawEdge(edge, INCOMING, 0.95, 1.5);
        for (const edge of linked.outgoing) drawEdge(edge, OUTGOING, 0.95, 1.5);
      }
      for (const node of graph.nodes) {
        const { x, y } = point(node);
        if (x < -12 || y < -12 || x > size.width + 12 || y > size.height + 12) continue;
        const isSelected = node.gid === selectedGid;
        const isNeighbor = linked.neighbors.has(node.gid);
        const matchesFilter = (roleFilter === "all" || node.role === roleFilter) &&
          (clusterFilter === null || node.cluster_id === clusterFilter);
        ctx.globalAlpha = isSelected ? 1 : selectedGid ? (isNeighbor && matchesFilter ? 0.95 : isNeighbor ? 0.18 : 0.08) : matchesFilter ? 0.9 : 0.09;
        ctx.fillStyle = ROLE_COLOR[node.role] ?? "#a6b8bc";
        ctx.beginPath();
        ctx.arc(x, y, isSelected ? 8 : isNeighbor ? 5.5 : 2.4 + node.priority_score * 1.5, 0, Math.PI * 2);
        ctx.fill();
        if (node.is_seed || isSelected) {
          ctx.strokeStyle = isSelected ? "#173b42" : "#2d5760";
          ctx.lineWidth = isSelected ? 2 : 1.2;
          ctx.beginPath();
          ctx.arc(x, y, isSelected ? 11 : 5.6 + node.priority_score * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (selectedGid) {
        const node = byGid.get(selectedGid);
        if (node) {
          const { x, y } = point(node);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#173b42";
          ctx.font = "600 11px ui-monospace, monospace";
          ctx.fillText(selectedGid, x + 16, y - 10);
        }
      }
      ctx.globalAlpha = 1;
    });
    return () => cancelAnimationFrame(frame);
  }, [graph, byGid, camera, size, selectedGid, linked, roleFilter, clusterFilter, maxAmount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.001);
      setCameraOverride((currentOverride) => {
        const current = currentOverride?.key === focusKey ? currentOverride.camera : baseCamera;
        const scale = Math.min(1200, Math.max(4, current.scale * factor));
        const ratio = scale / current.scale;
        return { key: focusKey, camera: { scale, offsetX: x - (x - current.offsetX) * ratio, offsetY: y - (y - current.offsetY) * ratio } };
      });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [focusKey, baseCamera]);

  function selectAt(x: number, y: number) {
    let nearest: string | null = null;
    let distance = 12 * 12;
    for (const node of graph.nodes) {
      const dx = node.x * camera.scale + camera.offsetX - x;
      const dy = node.y * camera.scale + camera.offsetY - y;
      const squared = dx * dx + dy * dy;
      if (squared < distance) { distance = squared; nearest = node.gid; }
    }
    if (nearest) onSelect(nearest);
  }

  return (
    <section className="map-panel" aria-label="Directed transfer map">
      <div className="map-head">
        <div><span className="section-kicker">DIRECTED NETWORK</span><h2>Transfer map</h2><p>Click an account to inspect its incoming and outgoing links.</p></div>
        <div className="map-actions"><button onClick={() => setCameraOverride({ key: focusKey, camera: fittedCamera() })}>Fit all</button><span>Scroll to zoom · drag to pan</span></div>
      </div>
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        aria-label="Interactive transfer graph"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          gesture.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, camera, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!gesture.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const dx = x - gesture.current.x;
          const dy = y - gesture.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) gesture.current.moved = true;
          if (gesture.current.moved) setCameraOverride({ key: focusKey, camera: { ...gesture.current.camera,
            offsetX: gesture.current.camera.offsetX + dx,
            offsetY: gesture.current.camera.offsetY + dy } });
        }}
        onPointerUp={(event) => {
          const drag = gesture.current;
          gesture.current = null;
          if (!drag?.moved) {
            const rect = event.currentTarget.getBoundingClientRect();
            selectAt(event.clientX - rect.left, event.clientY - rect.top);
          }
        }}
      />
      <div className="map-legend"><span><i className="legend-line incoming" />Received from → selected</span><span><i className="legend-line outgoing" />Selected → sent to</span><span><i className="legend-ring" />Seed account</span><span className="map-count">{graph.meta.n_nodes.toLocaleString("en-US")} accounts · {graph.meta.n_edges.toLocaleString("en-US")} directed links</span></div>
    </section>
  );
}
