/*
 * Copyright 2026 8dcc
 *
 * This file is part of logic-gates.js.
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * -----------------------------------------------------------------------------
 *
 * For more information, see: https://github.com/8dcc/logic-gates.js
 */

(function(global) {
'use strict';

/* ================================================================
 * Configuration
 * ================================================================ */

const LogicDiag = {
    tickRate : 1000,      /* ms between ticks for oscillating circuits */
    stabilityChecks : 20, /* max passes before declaring oscillation */
    debug : false,        /* enable debug rendering overlays         */
};

/* ================================================================
 * Parser
 * ================================================================ */

/* Split a DSL line into tokens, respecting quoted strings. */
function tokenizeLine(line) {
    const tokens = [];
    let i        = 0;
    while (i < line.length) {
        while (i < line.length && (line[i] === ' ' || line[i] === '\t'))
            i++;

        if (i >= line.length)
            break;

        if (line[i] === '"') {
            let j = i + 1;
            while (j < line.length && line[j] !== '"')
                j++;
            if (j >= line.length)
                throw new Error('Unterminated quoted string: ' + line);
            tokens.push(line.slice(i, j + 1));
            i = j + 1;
        } else {
            let j = i;
            while (j < line.length && line[j] !== ' ' && line[j] !== '\t')
                j++;
            tokens.push(line.slice(i, j));
            i = j;
        }
    }
    return tokens;
}

/* Remove surrounding double quotes from a token. */
function unquote(s) {
    return ((s.startsWith('"') && s.endsWith('"')) ||
            (s.startsWith('\'') && s.endsWith('\'')))
             ? s.slice(1, -1)
             : s;
}

/*
 * Parse a DSL string and return a Graph object:
 *   { nodes: Map, inputs: Node[], outputs: Node[], gates: Node[] }
 */
const Parser = {
    parse(text) {
        const nodes      = new Map();
        const inputs     = [];
        const outputs    = [];
        const gates      = [];
        const labels     = [];
        const rects      = [];
        let currentStage = 1;
        const rowByStage = new Map(); /* current row counter per stage */
        let pendingRow   = null;      /* set by 'row' hint, used once */

        const GATE_TYPES =
          new Set([ 'not', 'buf', 'and', 'or', 'nand', 'nor', 'xor', 'xnor' ]);
        const VALID_STATES = new Set([ '0', '1', 'true', 'false' ]);
        const lines        = text.split('\n');
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#'))
                continue;

            const tokens = tokenizeLine(line);
            const kw     = tokens[0].toLowerCase();

            if (kw === 'stage') {
                const n = parseInt(tokens[1], 10);
                if (isNaN(n))
                    throw new Error('Invalid stage number: ' + tokens[1]);
                currentStage = n;
                rowByStage.delete(n);
                pendingRow = null;
                continue;
            }

            if (kw === 'row') {
                const n = parseFloat(tokens[1]);
                if (isNaN(n))
                    throw new Error('Invalid row number: ' + tokens[1]);
                pendingRow = n;
                continue;
            }

            if (kw === 'input') {
                const id  = tokens[1];
                let init  = 0;
                let label = id;

                if (tokens.length === 2) {
                    /* input <id> */
                } else if (tokens.length === 3 || tokens.length === 4) {
                    /* input <id> <init> [<label>] */
                    if (!VALID_STATES.has(tokens[2])) {
                        throw new Error('Invalid input state: ' + tokens[2]);
                    }
                    init = (tokens[2] === '1' || tokens[2] === 'true') ? 1 : 0;
                    if (tokens.length === 4)
                        label = unquote(tokens[3]);
                } else {
                    throw new Error('Invalid input declaration: ' + line);
                }

                const inputRow =
                  pendingRow !== null ? pendingRow : (rowByStage.get(0) ?? 0);
                pendingRow = null;
                rowByStage.set(0, inputRow + 1);
                const node = {
                    id,
                    type : 'input',
                    ins : [],
                    label,
                    init,
                    stage : 0,
                    row : inputRow
                };
                nodes.set(id, node);
                inputs.push(node);
                continue;
            }

            if (kw === 'output') {
                const id = tokens[1];
                if (!nodes.has(id))
                    throw new Error('Undefined node referenced in output: ' +
                                    id);
                const label = tokens[2] ? unquote(tokens[2]) : id;
                const node  = {
                    id,
                    type : 'output',
                    ins : [ id ],
                    label,
                    stage : currentStage + 1
                };
                outputs.push(node);
                continue;
            }

            if (kw === 'rect') {
                if (tokens.length !== 5)
                    throw new Error('Invalid rect declaration: ' + line);
                const s1 = parseFloat(tokens[1]);
                const r1 = parseFloat(tokens[2]);
                const s2 = parseFloat(tokens[3]);
                const r2 = parseFloat(tokens[4]);
                if (isNaN(s1) || isNaN(s2))
                    throw new Error('Invalid rect stage: ' + line);
                if (isNaN(r1) || isNaN(r2))
                    throw new Error('Invalid rect row: ' + line);
                rects.push({ s1, r1, s2, r2 });
                continue;
            }

            if (kw === 'label') {
                if (tokens.length !== 4)
                    throw new Error('Invalid label declaration: ' + line);
                const text  = unquote(tokens[1]);
                const stage = parseFloat(tokens[2]);
                const row   = parseFloat(tokens[3]);
                if (isNaN(stage))
                    throw new Error('Invalid label stage: ' + tokens[2]);
                if (isNaN(row))
                    throw new Error('Invalid label row: ' + tokens[3]);
                labels.push({ text, stage, row });
                continue;
            }

            if (kw === 'wire') {
                if (tokens.length !== 5)
                    throw new Error('Invalid wire declaration: ' + line);
                const id    = tokens[1];
                const src   = tokens[2];
                const stage = parseFloat(tokens[3]);
                const row   = parseFloat(tokens[4]);
                if (isNaN(stage))
                    throw new Error('Invalid wire stage: ' + tokens[3]);
                if (isNaN(row))
                    throw new Error('Invalid wire row: ' + tokens[4]);
                const node = {
                    id,
                    type : 'wire',
                    ins : [ src ],
                    label : id,
                    stage,
                    row
                };
                nodes.set(id, node);
                gates.push(node);
                continue;
            }

            if (GATE_TYPES.has(kw)) {
                const id      = tokens[1];
                const ins     = tokens.slice(2);
                const gateRow = pendingRow !== null
                                  ? pendingRow
                                  : (rowByStage.get(currentStage) ?? 0);
                pendingRow    = null;
                rowByStage.set(currentStage, gateRow + 1);
                const node = {
                    id,
                    type : kw,
                    ins,
                    label : id,
                    stage : currentStage,
                    row : gateRow
                };
                nodes.set(id, node);
                gates.push(node);
                continue;
            }

            throw new Error('Unknown gate type: ' + tokens[0]);
        }

        for (const gate of gates)
            for (const inp of gate.ins)
                if (!nodes.has(inp))
                    throw new Error('Undefined node referenced: ' + inp);

        return { nodes, inputs, outputs, gates, labels, rects };
    },
};

LogicDiag._parse = Parser.parse.bind(Parser);

/* ================================================================
 * Layout
 * ================================================================ */

const GATE_W         = 60;
const GATE_H         = 40;
const COL_SPACING    = 140;
const ROW_SPACING    = 70;
const PADDING        = 50;
const OUT_DOT_OFFSET = 0.35 * COL_SPACING; /* gate centre to output dot */
/* Space from the last gate centre to the SVG right edge. */
const OUT_TAIL = OUT_DOT_OFFSET + 8 + 80 + 25;

/* Convert a (stage, row) grid position to SVG {x, y} coordinates. */
function stageRowToXY(stage, row, minRow) {
    return {
        x : PADDING + GATE_W / 2 + stage * COL_SPACING,
        y : PADDING + (row - minRow) * ROW_SPACING,
    };
}

/*
 * Assign center {x, y} coordinates to every node in 'graph'.
 * Returns { pos: Map<id, {x,y}>, width: number, height: number,
 *           minRow: number, maxStage: number }.
 */
const Layout = {
    compute(graph) {
        let maxGateStage = 0;
        for (const n of graph.gates)
            if (n.stage > maxGateStage)
                maxGateStage = n.stage;

        const outputStage = maxGateStage + 1;

        /* Find the row range used across all nodes. */
        let minRow = 0, maxRow = 0;
        for (const n of [...graph.inputs, ...graph.gates, ...graph.labels]) {
            if (n.row < minRow)
                minRow = n.row;
            if (n.row > maxRow)
                maxRow = n.row;
        }

        const canvasHeight = (maxRow - minRow) * ROW_SPACING + 2 * PADDING;
        const canvasWidth =
          stageRowToXY(maxGateStage, minRow, minRow).x + OUT_TAIL;

        const pos = new Map();

        for (const n of [...graph.inputs, ...graph.gates]) {
            pos.set(n.id, stageRowToXY(n.stage, n.row, minRow));
        }

        return {
            pos,
            width : canvasWidth,
            height : canvasHeight,
            maxStage : outputStage,
            minRow,
        };
    },
};

LogicDiag._layout = Layout.compute.bind(Layout);

/* ================================================================
 * Simulator
 * ================================================================ */

/*
 * Evaluate a gate given its type and inputs (values are 0, 1, or null).
 * Returns null if the output cannot be determined from the inputs.
 * Short-circuit rules apply: AND/NAND with a 0 input, OR/NOR with a 1
 * input, can resolve even when other inputs are null.
 */
function evalGate(type, inputs) {
    switch (type) {
        case 'not':
            return inputs[0] === null ? null : (inputs[0] === 0 ? 1 : 0);

        case 'buf':
            return inputs[0];

        case 'and':
            if (inputs.some(v => v === 0))
                return 0;
            if (inputs.some(v => v === null))
                return null;
            return 1;

        case 'or':
            if (inputs.some(v => v === 1))
                return 1;
            if (inputs.some(v => v === null))
                return null;
            return 0;

        case 'nand':
            if (inputs.some(v => v === 0))
                return 1;
            if (inputs.some(v => v === null))
                return null;
            return 0;

        case 'nor':
            if (inputs.some(v => v === 1))
                return 0;
            if (inputs.some(v => v === null))
                return null;
            return 1;

        case 'xor':
            if (inputs.some(v => v === null))
                return null;
            return inputs.reduce((a, b) => a ^ b, 0);

        case 'xnor':
            if (inputs.some(v => v === null))
                return null;
            return inputs.reduce((a, b) => a ^ b, 0) === 0 ? 1 : 0;

        case 'wire':
            return inputs[0] ?? null;

        default:
            return null;
    }
}

/*
 * Sort 'graph.gates' in topological order (inputs-first). Uses Kahn's
 * algorithm. Gates that are part of a cycle cannot be fully ordered and
 * are appended at the end in their original declaration order.
 */
function topoSortGates(graph) {
    const gateIds  = new Set(graph.gates.map(g => g.id));
    const indegree = new Map();
    const children = new Map();

    for (const gate of graph.gates) {
        indegree.set(gate.id, 0);
        children.set(gate.id, []);
    }
    for (const gate of graph.gates) {
        for (const inp of gate.ins) {
            if (gateIds.has(inp)) {
                indegree.set(gate.id, indegree.get(gate.id) + 1);
                children.get(inp).push(gate.id);
            }
        }
    }

    const queue = [];
    for (const gate of graph.gates) {
        if (indegree.get(gate.id) === 0)
            queue.push(gate.id);
    }

    const sorted  = [];
    const visited = new Set();
    while (queue.length > 0) {
        const id = queue.shift();
        visited.add(id);
        sorted.push(id);
        for (const next of children.get(id)) {
            const deg = indegree.get(next) - 1;
            indegree.set(next, deg);
            if (deg === 0)
                queue.push(next);
        }
    }

    /* Append cyclic gates in declaration order */
    for (const gate of graph.gates)
        if (!visited.has(gate.id))
            sorted.push(gate.id);

    return sorted.map(id => graph.nodes.get(id));
}

const Simulator = {
    /* Single propagation pass over 'graph'. Gates are processed in
     * topological order; cyclic nodes use their current value from
     * 'state'. Returns a new Map<id, 0|1|null>. */
    evaluate(graph, state) {
        const next = new Map(state);
        for (const gate of graph.gates)
            if (!next.has(gate.id))
                next.set(gate.id, null);

        for (const gate of topoSortGates(graph)) {
            const inputs = gate.ins.map(id => next.get(id) ?? null);
            next.set(gate.id, evalGate(gate.type, inputs));
        }

        return next;
    },

    /* Runs evaluate() until stable or oscillation limit reached. */
    stabilize(graph, state) {
        const first = Simulator.evaluate(graph, state);
        let prev    = first;
        for (let i = 1; i < LogicDiag.stabilityChecks; i++) {
            const next = Simulator.evaluate(graph, prev);
            let stable = true;
            for (const [id, val] of next) {
                if (prev.get(id) !== val) {
                    stable = false;
                    break;
                }
            }
            if (stable)
                return { state : next, stable : true };
            prev = next;
        }
        return { state : first, stable : false };
    },
};

LogicDiag._simulate       = Simulator.evaluate.bind(Simulator);
LogicDiag._checkStability = Simulator.stabilize.bind(Simulator);

/* ================================================================
 * SVG Renderer
 * ================================================================ */

const PIN_LEFT     = 20; /* centre to input pin x */
const PIN_RIGHT    = 20; /* centre to output pin x */
const HALF_HEIGHT  = 13; /* half-height of gate body */
const PIN_OFFSET_Y = 8;  /* y-offset of top/bottom input pins */
const BUBBLE_R     = 4;  /* invert bubble radius */

/* Signal state -> CSS color string */
const COLOR_HIGH    = '#22c55e'; /* bright green */
const COLOR_LOW     = '#b45252'; /* muted red    */
const COLOR_UNKNOWN = '#888888'; /* neutral grey */

function sigColor(val) {
    switch (val) {
        case 0:
            return COLOR_LOW;
        case 1:
            return COLOR_HIGH;
        default:
            return COLOR_UNKNOWN;
    }
}

/* Escape special XML characters in text content. */
function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

function gateShape(type, cx, cy) {
    const sk = 'stroke="#111" stroke-width="1.5" fill="white"';

    switch (type) {
        case 'buf':
            return `<polygon points="${cx - PIN_LEFT},${cy - HALF_HEIGHT} ${
              cx -
              PIN_LEFT},${cy + HALF_HEIGHT} ${cx + PIN_RIGHT},${cy}" ${sk}/>`;

        case 'not':
            /* Triangle tip at cx+PIN_RIGHT-2*BUBBLE_R so bubble right edge =
             * cx+PIN_RIGHT */
            return (`<polygon points="${cx - PIN_LEFT},${cy - HALF_HEIGHT} ${
                      cx - PIN_LEFT},${cy + HALF_HEIGHT} ${
                      cx + PIN_RIGHT - BUBBLE_R * 2},${cy}" ${sk}/>` +
                    `<circle cx="${cx + PIN_RIGHT - BUBBLE_R}" cy="${cy}" r="${
                      BUBBLE_R}" ${sk}/>`);

        case 'and':
            /* D-shape: flat left side, two quadratic beziers on the right */
            return (
              `<path d="M${cx - PIN_LEFT},${cy - HALF_HEIGHT} H${cx - 4}` +
              ` Q${cx + PIN_RIGHT},${cy - HALF_HEIGHT} ${cx + PIN_RIGHT},${
                cy}` +
              ` Q${cx + PIN_RIGHT},${cy + HALF_HEIGHT} ${cx - 4},${
                cy + HALF_HEIGHT}` +
              ` H${cx - PIN_LEFT} Z" ${sk}/>`);

        case 'nand': {
            /* D-shape body ending before bubble */
            const bx =
              cx + PIN_RIGHT - BUBBLE_R * 2; /* body right edge = cx+12 */
            return (
              `<path d="M${cx - PIN_LEFT},${cy - HALF_HEIGHT} H${cx - 4}` +
              ` Q${bx},${cy - HALF_HEIGHT} ${bx},${cy}` +
              ` Q${bx},${cy + HALF_HEIGHT} ${cx - 4},${cy + HALF_HEIGHT}` +
              ` H${cx - PIN_LEFT} Z" ${sk}/>` +
              `<circle cx="${cx + PIN_RIGHT - BUBBLE_R}" cy="${cy}" r="${
                BUBBLE_R}" ${sk}/>`);
        }

        case 'or':
            /* Curved back, pointed front */
            return (`<path d="M${cx - PIN_LEFT},${cy - HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 12},${cy - HALF_HEIGHT} ${
                      cx + PIN_RIGHT},${cy}` +
                    ` Q${cx - PIN_LEFT + 12},${cy + HALF_HEIGHT} ${
                      cx - PIN_LEFT},${cy + HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 7},${cy} ${cx - PIN_LEFT},${
                      cy - HALF_HEIGHT} Z" ${sk}/>`);

        case 'nor': {
            const bx = cx + PIN_RIGHT - BUBBLE_R * 2;
            return (`<path d="M${cx - PIN_LEFT},${cy - HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 12},${cy - HALF_HEIGHT} ${bx},${cy}` +
                    ` Q${cx - PIN_LEFT + 12},${cy + HALF_HEIGHT} ${
                      cx - PIN_LEFT},${cy + HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 7},${cy} ${cx - PIN_LEFT},${
                      cy - HALF_HEIGHT} Z" ${sk}/>` +
                    `<circle cx="${cx + PIN_RIGHT - BUBBLE_R}" cy="${cy}" r="${
                      BUBBLE_R}" ${sk}/>`);
        }

        case 'xor':
            /* OR body + extra arc on left */
            return (`<path d="M${cx - PIN_LEFT},${cy - HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 12},${cy - HALF_HEIGHT} ${
                      cx + PIN_RIGHT},${cy}` +
                    ` Q${cx - PIN_LEFT + 12},${cy + HALF_HEIGHT} ${
                      cx - PIN_LEFT},${cy + HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 7},${cy} ${cx - PIN_LEFT},${
                      cy - HALF_HEIGHT} Z" ${sk}/>` +
                    `<path d="M${cx - PIN_LEFT - 5},${cy - HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 2},${cy} ${cx - PIN_LEFT - 5},${
                      cy + HALF_HEIGHT}" fill="none" ${sk}/>`);

        case 'xnor': {
            const bx = cx + PIN_RIGHT - BUBBLE_R * 2;
            return (`<path d="M${cx - PIN_LEFT},${cy - HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 12},${cy - HALF_HEIGHT} ${bx},${cy}` +
                    ` Q${cx - PIN_LEFT + 12},${cy + HALF_HEIGHT} ${
                      cx - PIN_LEFT},${cy + HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 7},${cy} ${cx - PIN_LEFT},${
                      cy - HALF_HEIGHT} Z" ${sk}/>` +
                    `<path d="M${cx - PIN_LEFT - 5},${cy - HALF_HEIGHT}` +
                    ` Q${cx - PIN_LEFT + 2},${cy} ${cx - PIN_LEFT - 5},${
                      cy + HALF_HEIGHT}" fill="none" ${sk}/>` +
                    `<circle cx="${cx + PIN_RIGHT - BUBBLE_R}" cy="${cy}" r="${
                      BUBBLE_R}" ${sk}/>`);
        }

        default:
            return '';
    }
}

/*
 * Return the output pin position { x, y } for a gate at (cx, cy).
 * For inverted gates the bubble right edge is cx+PIN_RIGHT.
 */
function outPin(type, cx, cy) {
    if (type === 'wire')
        return { x : cx, y : cy };
    return { x : cx + PIN_RIGHT, y : cy };
}

/*
 * Return input pin positions [{ x, y }, ...] for a gate at (cx, cy).
 * For XOR/XNOR the extra left arc shifts the effective pin x inward.
 */
function inPins(type, cx, cy) {
    if (type === 'wire')
        return [ { x : cx, y : cy } ];
    if (type === 'not' || type === 'buf')
        return [ { x : cx - PIN_LEFT, y : cy } ];
    const isXorFamily = type === 'xor' || type === 'xnor';
    const x           = isXorFamily ? cx - PIN_LEFT + 5 : cx - PIN_LEFT;
    return [ { x, y : cy - PIN_OFFSET_Y }, { x, y : cy + PIN_OFFSET_Y } ];
}

/*
 * Render a debug grid aligned to the stage/row coordinate system.
 * Minor lines every 0.25 units; major lines (integer values) are
 * slightly thicker and labelled.
 */
function renderDebugGrid(layout) {
    const { width, height, minRow } = layout;
    const parts                     = [];

    /* Vertical lines per stage increment */
    const stageMin =
      Math.ceil((0 - PADDING - GATE_W / 2) / COL_SPACING * 4) / 4;
    const stageMax =
      Math.floor((width - PADDING - GATE_W / 2) / COL_SPACING * 4) / 4;
    const stageSteps = Math.round((stageMax - stageMin) / 0.25);
    for (let i = 0; i <= stageSteps; i++) {
        const s     = stageMin + i * 0.25;
        const x     = PADDING + GATE_W / 2 + s * COL_SPACING;
        const major = Math.abs(Math.round(s) - s) < 0.01;
        parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"` +
                   ` stroke="#aaa" stroke-width="${major ? 0.8 : 0.3}"` +
                   ` stroke-dasharray="${major ? '5,4' : '2,5'}"/>`);
    }

    /* Horizontal lines per row increment */
    const rowStart = Math.ceil((0 - PADDING) / ROW_SPACING * 4) / 4 + minRow;
    const rowEnd =
      Math.floor((height - PADDING) / ROW_SPACING * 4) / 4 + minRow;
    const rowSteps = Math.round((rowEnd - rowStart) / 0.25);
    for (let i = 0; i <= rowSteps; i++) {
        const r     = rowStart + i * 0.25;
        const y     = PADDING + (r - minRow) * ROW_SPACING;
        const major = Math.abs(Math.round(r) - r) < 0.01;
        parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"` +
                   ` stroke="#aaa" stroke-width="${major ? 0.8 : 0.3}"` +
                   ` stroke-dasharray="${major ? '5,4' : '2,5'}"/>`);
    }

    return parts.join('\n');
}

/*
 * Render all wires as orthogonal SVG paths.
 * Forward wires (source stage < target stage): H to midpoint, diagonal
 * to target y, short H to pin.
 * Backward wires (feedback loops): short H right, short V up/down,
 * diagonal to near destination, short V to target y, H to pin.
 */
function renderWires(graph, layout, simState) {
    const { pos } = layout;
    const parts   = [];

    for (const node of [...graph.inputs, ...graph.gates]) {
        const dstPos = pos.get(node.id);
        if (!dstPos)
            continue;
        const pins = inPins(node.type, dstPos.x, dstPos.y);

        node.ins.forEach((srcId, i) => {
            const srcNode =
              graph.nodes.get(srcId) || graph.inputs.find(n => n.id === srcId);
            if (!srcNode)
                return;

            const srcPos = pos.get(srcId);
            if (!srcPos)
                return;

            const color  = sigColor(simState.get(srcId) ?? null);
            const pin    = pins[i] || pins[0];
            const srcPin = outPin(srcNode.type, srcPos.x, srcPos.y);
            const tx = pin.x, ty = pin.y;
            const sx = srcPin.x, sy = srcPin.y;

            let d;
            if (sx < tx - 5) {
                /* Forward wire: horizontal to dst_stage-0.5, diagonal to
                 * dst_stage-0.25, then short stub to pin. */
                const stageCx = tx + PIN_LEFT;
                const diagX0  = stageCx - 0.5 * COL_SPACING;
                const diagX1  = stageCx - 0.35 * COL_SPACING;
                d = `M${sx},${sy} H${diagX0} L${diagX1},${ty} H${tx}`;
            } else {
                const exitX = srcPos.x + 0.25 * COL_SPACING;
                if (Math.abs(ty - sy) < ROW_SPACING / 2) {
                    /* Same-row feedback: rectangular bracket. Direction is
                     * determined by whether the destination pin is above or
                     * below the gate centre (first vs second input). */
                    const archHeight = 30;
                    const dir        = ty > dstPos.y ? 1 : -1;
                    const archY      = sy + dir * archHeight;
                    const dstStubX   = dstPos.x - 0.35 * COL_SPACING;
                    d                = `M${sx},${sy} H${exitX} V${archY}` +
                        ` H${dstStubX} V${ty} H${tx}`;
                } else {
                    /* Backward (feedback) wire: horizontal to src+0.25 stage,
                     * short vertical, diagonal to dst-0.25 stage, short
                     * vertical, horizontal to pin. */
                    const diagEndX = dstPos.x - 0.25 * COL_SPACING;
                    const topStub  = 15;
                    const botStub  = 15;
                    const dir      = ty <= sy ? -1 : 1;
                    const preY     = sy + dir * topStub;
                    const postY    = ty - dir * botStub;
                    d              = `M${sx},${sy} H${exitX} V${preY}` +
                        ` L${diagEndX},${postY} V${ty} H${tx}`;
                }
            }

            parts.push(`<path d="${d}" fill="none" stroke="${color}"` +
                       ` stroke-width="2" stroke-linejoin="round"/>`);
        });
    }

    /* Draw wires from gate output pins to output label dots */
    for (const out of graph.outputs) {
        const srcId   = out.ins[0];
        const srcNode = graph.nodes.get(srcId);
        if (!srcNode)
            continue;

        const srcPos = pos.get(srcId);
        if (!srcPos)
            continue;

        const color = sigColor(simState.get(srcId) ?? null);
        const sOut  = outPin(srcNode.type, srcPos.x, srcPos.y);
        /* The output dot is rendered at srcPos.x + 0.5*COL_SPACING */
        parts.push(
          `<path d="M${sOut.x},${sOut.y} H${srcPos.x + OUT_DOT_OFFSET}"` +
          ` fill="none" stroke="${color}" stroke-width="2"/>`);
    }

    return parts.join('\n');
}

/*
 * Render input nodes as clickable toggle buttons.
 * Each button shows the current value (0/1) and calls
 * LogicDiag._toggle(this) on click.
 */
function renderInputs(graph, pos, simState) {
    const parts = [];
    for (const inp of graph.inputs) {
        const p = pos.get(inp.id);
        if (!p)
            continue;

        const val   = simState.get(inp.id) ?? 0;
        const color = sigColor(val);
        const bx    = p.x - 12; /* left edge of button (centered at stage) */

        /* Label to the left of the button */
        parts.push(`<text x="${bx - 8}" y="${p.y + 5}"` +
                   ` font-family="monospace" font-size="14" fill="#222"` +
                   ` text-anchor="end">${escapeXml(inp.label)}</text>`);

        /* Wire from right edge of button to output pin (rendered before
         * the button so it appears behind it) */
        parts.push(`<line x1="${p.x + 12}" y1="${p.y}"` +
                   ` x2="${p.x + PIN_RIGHT}" y2="${p.y}"` +
                   ` stroke="${color}" stroke-width="2"/>`);

        /* Clickable toggle button: colored rect + value digit */
        parts.push(
          `<g class="ld-input" cursor="pointer"` +
          ` onclick="LogicDiag._toggle(this)"` +
          ` data-node="${escapeXml(inp.id)}">` +
          `<rect x="${bx}" y="${p.y - 12}" width="24" height="24"` +
          ` rx="4" fill="${color}" stroke="#333" stroke-width="1.5"/>` +
          `<text x="${p.x}" y="${p.y + 5}"` +
          ` text-anchor="middle" font-family="monospace"` +
          ` font-size="13" font-weight="bold" fill="#fff"` +
          ` pointer-events="none">${val}</text>` +
          `</g>`);
    }
    return parts.join('\n');
}

/*
 * Render output labels and colored dots to the right of each output
 * gate's output pin.
 */
function renderOutputs(graph, layout, simState) {
    const { pos } = layout;
    const parts   = [];
    for (const out of graph.outputs) {
        const srcId   = out.ins[0];
        const srcNode = graph.nodes.get(srcId);
        if (!srcNode)
            continue;

        const srcPos = pos.get(srcId);
        if (!srcPos)
            continue;

        const color = sigColor(simState.get(srcId) ?? null);
        const op    = outPin(srcNode.type, srcPos.x, srcPos.y);
        const dotX  = srcPos.x + OUT_DOT_OFFSET;
        parts.push(`<circle cx="${dotX}" cy="${op.y}" r="4"` +
                   ` fill="${color}"/>`);
        parts.push(`<text x="${dotX + 8}" y="${op.y + 5}"` +
                   ` font-family="monospace" font-size="14" fill="#222"` +
                   `>${escapeXml(out.label)}</text>`);
    }
    return parts.join('\n');
}

/* Render background rectangles placed with the 'rect' instruction. */
function renderRects(graph, layout) {
    const { minRow } = layout;
    const parts      = [];
    for (const r of graph.rects) {
        const { x : x1, y : y1 } = stageRowToXY(r.s1, r.r1, minRow);
        const { x : x2, y : y2 } = stageRowToXY(r.s2, r.r2, minRow);
        parts.push(
          `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}"` +
          ` width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}"` +
          ` rx="6" fill="#f0f4ff" stroke="#c0cce8"` +
          ` stroke-width="1" stroke-dasharray="4,3"/>`);
    }
    return parts.join('\n');
}

/* Render free-floating text labels placed with the 'label' instruction. */
function renderLabels(graph, layout) {
    const { minRow } = layout;
    const parts      = [];
    for (const lbl of graph.labels) {
        const { x, y } = stageRowToXY(lbl.stage, lbl.row, minRow);
        parts.push(`<text x="${x}" y="${y}" font-family="monospace"` +
                   ` font-size="13" fill="#222"` +
                   ` text-anchor="middle">${escapeXml(lbl.text)}</text>`);
    }
    return parts.join('\n');
}

/*
 * Render a complete SVG diagram string.
 * graph    - parsed Graph
 * layout   - layout result from Layout.compute()
 * simState - SimState (Map<id, 0|1|null>)
 */
const Renderer = {
    render(graph, layout, simState) {
        const { pos, width, height } = layout;

        const parts = [ `<svg xmlns="http://www.w3.org/2000/svg"` +
                        ` class="logicdiag"` +
                        ` viewBox="0 0 ${width} ${height}"` +
                        ` width="${width}" height="${height}"` +
                        ` style="display:block;max-width:100%;margin:auto;">` ];

        parts.push(renderRects(graph, layout));

        if (LogicDiag.debug)
            parts.push(renderDebugGrid(layout));

        parts.push(renderWires(graph, layout, simState));

        for (const gate of graph.gates) {
            if (gate.type === 'wire')
                continue;
            const p = pos.get(gate.id);
            if (!p)
                continue;
            parts.push(gateShape(gate.type, p.x, p.y));
        }

        if (LogicDiag.debug) {
            for (const gate of graph.gates) {
                if (gate.type !== 'wire')
                    continue;
                const p = pos.get(gate.id);
                if (!p)
                    continue;
                const color = sigColor(simState.get(gate.id) ?? null);
                parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3"` +
                           ` fill="${color}"/>`);
            }
        }

        parts.push(renderInputs(graph, pos, simState));
        parts.push(renderOutputs(graph, layout, simState));
        parts.push(renderLabels(graph, layout));

        parts.push('</svg>');
        return parts.join('\n');
    },
};

LogicDiag._render = Renderer.render.bind(Renderer);

/* ================================================================
 * Diagram Registry
 * ================================================================ */

const Registry = {
    _diagrams : new Map(),

    redraw(entry) {
        if (entry.timerId) {
            clearTimeout(entry.timerId);
            entry.timerId = null;
        }
        const { state : newState, stable } =
          Simulator.stabilize(entry.graph, entry.state);
        entry.state = newState;

        const inner = [
            renderRects(entry.graph, entry.layout),
            LogicDiag.debug ? renderDebugGrid(entry.layout) : '',
            renderWires(entry.graph, entry.layout, newState),
            ...entry.graph.gates.map(g => {
                const p = entry.layout.pos.get(g.id);
                return p ? gateShape(g.type, p.x, p.y) : '';
            }),
            renderInputs(entry.graph, entry.layout.pos, newState),
            renderOutputs(entry.graph, entry.layout, newState),
            renderLabels(entry.graph, entry.layout),
        ].join('\n');
        entry.svgEl.innerHTML = inner;

        if (!stable)
            entry.timerId =
              setTimeout(() => Registry.redraw(entry), LogicDiag.tickRate);
    },

    /* Toggle the value of an input node and redraw. 'el' is the
     * <g class="ld-input"> element that was clicked. */
    toggle(el) {
        const svgEl  = el.closest('svg');
        const nodeId = el.getAttribute('data-node');
        const entry  = Registry._diagrams.get(svgEl);
        if (!entry || !nodeId)
            return;
        const cur = entry.state.get(nodeId) ?? 0;
        entry.state.set(nodeId, cur === 1 ? 0 : 1);
        Registry.redraw(entry);
    },

    renderDiagram(text) {
        const graph  = Parser.parse(text);
        const layout = Layout.compute(graph);

        const state = new Map();
        for (const inp of graph.inputs)
            state.set(inp.id, inp.init);
        for (const gate of graph.gates)
            state.set(gate.id, null);

        const { state : initState, stable } = Simulator.stabilize(graph, state);
        const svgStr = Renderer.render(graph, layout, initState);

        const tmp     = document.createElement('div');
        tmp.innerHTML = svgStr;
        const svgEl   = tmp.firstChild;

        const entry = {
            graph,
            layout,
            svgEl,
            state : initState,
            timerId : null,
        };
        Registry._diagrams.set(svgEl, entry);

        if (!stable)
            entry.timerId =
              setTimeout(() => Registry.redraw(entry), LogicDiag.tickRate);

        return svgEl;
    },
};

/* ================================================================
 * Export
 * ================================================================ */

LogicDiag._toggle = Registry.toggle.bind(Registry);

global.LogicDiag = LogicDiag;
if (typeof module !== 'undefined' && module.exports)
    module.exports = LogicDiag;

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        const scripts =
          document.querySelectorAll('script[type="text/logicdiag"]');
        scripts.forEach(function(script) {
            try {
                const svgEl = Registry.renderDiagram(script.textContent);
                const wrap  = document.createElement('div');
                wrap.style.textAlign = 'center';
                wrap.appendChild(svgEl);
                script.parentNode.insertBefore(wrap, script.nextSibling);
            } catch (e) {
                const err = document.createElement('pre');
                err.style.cssText =
                  'color:red;border:1px solid red;padding:8px;' +
                  'font-family:monospace;';
                err.textContent = 'logic-diagram error: ' + e.message;
                script.parentNode.insertBefore(err, script.nextSibling);
            }
        });
    });
}
}(typeof window !== 'undefined' ? window : global));
