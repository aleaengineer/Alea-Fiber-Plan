const STORAGE_KEY = 'fiber-ratio-network-v1';
const MAX_OUTPUTS = 128;
const MIN_CABLE_LENGTH = 0.01;
const DEFAULT_NETWORK = {
  txPower: 15,
  laserFrequency: 1550,
  attenuation: 0.35,
  feederLength: 5,
  minEndSignal: -28,
  connectorLoss: 0.3,
  safetyMargin: 3,
  nextId: 2,
  rootId: 1,
  selected: { type: 'transmitter' },
  splitters: {
    1: {
      id: 1,
      couplerType: 'none',
      splitCount: 1,
      ratioA: 100,
      loss: 0,
      ports: [{ length: MIN_CABLE_LENGTH, childId: null }]
    }
  }
};

let network = loadNetwork();
let calculated = { nodes: {}, outputs: {} };

const svg = document.querySelector('#network-map');
const mapScroll = document.querySelector('.map-scroll');
const editorBody = document.querySelector('#editor-body');
let mapLayout = null;
let mapZoom = 1;
let dragState = null;
let suppressMapClick = false;

function resizeMapCanvas() {
  if (!mapLayout) return;
  const fitWidth = Math.min(
    mapScroll.clientWidth,
    mapScroll.clientHeight * mapLayout.width / mapLayout.height
  );
  const width = Math.max(1, Math.round(fitWidth * mapZoom));
  const height = Math.max(1, Math.round(width * mapLayout.height / mapLayout.width));
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  document.querySelector('#map-zoom-level').textContent = `${Math.round(mapZoom * 100)}%`;
  document.querySelector('#map-zoom-out').disabled = mapZoom <= 0.5;
}

function setMapZoom(zoom, pointerX = mapScroll.clientWidth / 2, pointerY = mapScroll.clientHeight / 2) {
  if (!mapLayout) return;
  const nextZoom = Math.max(0.5, zoom);
  if (!Number.isFinite(nextZoom)) return;
  if (nextZoom === mapZoom) return;
  const mapRect = svg.getBoundingClientRect();
  const scrollRect = mapScroll.getBoundingClientRect();
  const oldScale = svg.clientWidth / mapLayout.width;
  const pointX = (scrollRect.left + pointerX - mapRect.left) / oldScale;
  const pointY = (scrollRect.top + pointerY - mapRect.top) / oldScale;
  mapZoom = nextZoom;
  resizeMapCanvas();

  const newRect = svg.getBoundingClientRect();
  const newScale = svg.clientWidth / mapLayout.width;
  if (svg.clientWidth > mapScroll.clientWidth) {
    mapScroll.scrollLeft += newRect.left - scrollRect.left + pointX * newScale - pointerX;
  } else {
    mapScroll.scrollLeft = 0;
  }
  if (svg.clientHeight > mapScroll.clientHeight) {
    mapScroll.scrollTop += newRect.top - scrollRect.top + pointY * newScale - pointerY;
  } else {
    mapScroll.scrollTop = 0;
  }
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_NETWORK));
}

function validTree(networkState, id, seen = new Set()) {
  const node = networkState.splitters[id];
  if (!node || seen.has(id) || seen.size >= 127) return false;
  seen.add(id);
  if (!Number.isInteger(node.splitCount) || node.splitCount < 1 || node.splitCount > 128) return false;
  if (!['fbt', 'plc', 'none'].includes(node.couplerType)) return false;
  if ((node.couplerType === 'fbt' && node.splitCount !== 2)
    || (node.couplerType === 'none' && node.splitCount !== 1)
    || (node.couplerType === 'plc' && node.splitCount < 2)) return false;
  const validRatio = node.splitCount === 1
    ? node.ratioA === 100
    : Number.isFinite(node.ratioA) && node.ratioA >= 1 && node.ratioA <= 50;
  if (!validRatio) return false;
  if (!Number.isFinite(node.loss) || node.loss < 0 || node.loss > 20) return false;
  if (!Array.isArray(node.ports) || node.ports.length !== node.splitCount) return false;
  for (const port of node.ports) {
    const length = port.length;
    if (!Number.isFinite(length) || length < MIN_CABLE_LENGTH || length > 1000) return false;
    if (port.childId !== null && !validTree(networkState, port.childId, seen)) return false;
  }
  return true;
}

function migrateNetwork(parsed) {
  if (Number.isFinite(parsed.feederLength)) {
    parsed.feederLength = Math.max(MIN_CABLE_LENGTH, parsed.feederLength);
  }
  for (const node of Object.values(parsed.splitters)) {
    if (!Array.isArray(node.ports)) {
      node.splitCount = 2;
      node.ports = [
        { length: node.lengthA, childId: node.childA },
        { length: node.lengthB, childId: node.childB }
      ];
      node.ratioA = Math.min(50, Math.max(1, node.ratioA));
      delete node.lengthA;
      delete node.lengthB;
      delete node.childA;
      delete node.childB;
    }
    if (!node.couplerType) node.couplerType = node.splitCount === 1 ? 'none' : node.splitCount > 2 ? 'plc' : 'fbt';
    for (const port of node.ports) {
      if (Number.isFinite(port.length)) port.length = Math.max(MIN_CABLE_LENGTH, port.length);
    }
  }
  if (parsed.selected.type === 'output' && parsed.selected.portIndex === undefined) {
    parsed.selected.portIndex = parsed.selected.branch === 'A' ? 0 : 1;
    delete parsed.selected.branch;
  }
  return parsed;
}

function countNetworkOutputs(networkState, id) {
  const node = networkState.splitters[id];
  return node.ports.reduce(
    (count, port) => count + (port.childId ? countNetworkOutputs(networkState, port.childId) : 1),
    0
  );
}

function loadNetwork() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return cloneDefault();
    const parsed = migrateNetwork(JSON.parse(saved));
    const validGlobals = Number.isFinite(parsed.txPower)
      && parsed.txPower >= -60 && parsed.txPower <= 30
      && Number.isFinite(parsed.laserFrequency) && parsed.laserFrequency >= 700 && parsed.laserFrequency <= 2000
      && Number.isFinite(parsed.attenuation) && parsed.attenuation >= 0 && parsed.attenuation <= 10
      && Number.isFinite(parsed.feederLength) && parsed.feederLength >= MIN_CABLE_LENGTH && parsed.feederLength <= 1000
      && Number.isFinite(parsed.minEndSignal) && parsed.minEndSignal >= -60 && parsed.minEndSignal <= 10
      && Number.isFinite(parsed.connectorLoss) && parsed.connectorLoss >= 0 && parsed.connectorLoss <= 10
      && Number.isFinite(parsed.safetyMargin) && parsed.safetyMargin >= 0 && parsed.safetyMargin <= 30;
    if (!validGlobals || !parsed.splitters || !validTree(parsed, parsed.rootId)
      || countNetworkOutputs(parsed, parsed.rootId) > MAX_OUTPUTS) return cloneDefault();
    if (!parsed.selected || !['transmitter', 'splitter', 'output'].includes(parsed.selected.type)) {
      parsed.selected = { type: 'splitter', id: parsed.rootId };
    }
    if (parsed.selected.type === 'splitter' && !parsed.splitters[parsed.selected.id]) {
      parsed.selected = { type: 'splitter', id: parsed.rootId };
    }
    if (parsed.selected.type === 'output'
      && (!parsed.splitters[parsed.selected.parentId]
        || !parsed.splitters[parsed.selected.parentId].ports[parsed.selected.portIndex])) {
      parsed.selected = { type: 'splitter', id: parsed.rootId };
    }
    return parsed;
  } catch (error) {
    console.warn('Jaringan tersimpan tidak dapat dibaca; menggunakan diagram awal.', error);
    return cloneDefault();
  }
}

function persistNetwork() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(network));
    document.querySelector('.save-status').innerHTML = '<i></i> TERSIMPAN DI PERANGKAT';
  } catch (error) {
    console.error('Perubahan jaringan tidak dapat disimpan di perangkat.', error);
    document.querySelector('.save-status').textContent = 'PENYIMPANAN TIDAK TERSEDIA';
  }
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function getPortFraction(node, index) {
  if (node.couplerType === 'none') return 1;
  if (node.couplerType === 'fbt') {
    return index === 0 ? node.ratioA / 100 : (100 - node.ratioA) / 100;
  }
  return 1 / node.splitCount;
}

function getNodeInsertionLoss(node) {
  return node.couplerType === 'none' ? 0 : node.loss;
}

function splitterCount(id = network.rootId) {
  const node = network.splitters[id];
  const isSplitter = node.couplerType !== 'none' ? 1 : 0;
  return isSplitter + node.ports.reduce(
    (count, port) => count + (port.childId ? splitterCount(port.childId) : 0),
    0
  );
}

function outputCount(id = network.rootId) {
  const node = network.splitters[id];
  return node.ports.reduce((count, port) => count + (port.childId ? outputCount(port.childId) : 1), 0);
}

function outputCountForSplitCount(node, splitCount) {
  const connectedPorts = node.ports.slice(0, splitCount);
  const nestedOutputAdjustment = connectedPorts.reduce(
    (count, port) => count + (port.childId ? outputCount(port.childId) - 1 : 0),
    0
  );
  return splitCount + nestedOutputAdjustment;
}

function findParentPort(targetId, id = network.rootId) {
  const node = network.splitters[id];
  for (let portIndex = 0; portIndex < node.ports.length; portIndex += 1) {
    const port = node.ports[portIndex];
    if (port.childId === targetId) return { node, portIndex };
    if (port.childId) {
      const parent = findParentPort(targetId, port.childId);
      if (parent) return parent;
    }
  }
  return null;
}

function updateCalculations() {
  calculated = { nodes: {}, outputs: {} };

  function visit(id, incomingPower) {
    const node = network.splitters[id];
    calculated.nodes[id] = incomingPower;
    node.ports.forEach((port, index) => {
      const fraction = getPortFraction(node, index);
      const splitterLoss = getNodeInsertionLoss(node);
      const powerAfterSplit = incomingPower + 10 * Math.log10(fraction) - splitterLoss;
      const powerAtEnd = powerAfterSplit
        - network.attenuation * port.length
        - network.connectorLoss;
      const childId = port.childId;
      if (childId) visit(childId, powerAtEnd);
      else calculated.outputs[`${id}-${index}`] = powerAtEnd;
    });
  }

  visit(network.rootId, network.txPower
    - network.attenuation * network.feederLength
    - network.connectorLoss);
}

function createSvgLayout() {
  const totalOutputs = outputCount();
  const spacing = totalOutputs <= 4 ? 170 : 130;
  const width = Math.max(720, 260 + (totalOutputs - 1) * spacing);
  const startX = (width - (totalOutputs - 1) * spacing) / 2;
  const positions = { nodes: {}, ports: {} };
  let leafIndex = 0;
  let maxDepth = 0;

  function place(id, depth) {
    const node = network.splitters[id];
    const y = 132 + depth * 160;
    maxDepth = Math.max(maxDepth, depth);
    const outlets = node.ports.map((port, index) => {
      if (port.childId) {
        const childX = place(port.childId, depth + 1);
        const childY = 132 + (depth + 1) * 160;
        return { x: childX, y: childY - 20, childId: port.childId };
      }
      const x = startX + leafIndex * spacing;
      leafIndex += 1;
      return { x, y: y + 132, childId: null };
    });
    const x = (outlets[0].x + outlets[outlets.length - 1].x) / 2;
    positions.nodes[id] = { x, y, depth };
    outlets.forEach((outlet, index) => { positions.ports[`${id}-${index}`] = outlet; });
    return x;
  }

  place(network.rootId, 0);
  return { width, height: Math.max(340, 320 + maxDepth * 160), positions };
}

function renderMap() {
  updateCalculations();
  const layout = createSvgLayout();
  const { width, height, positions } = layout;
  const rootPosition = positions.nodes[network.rootId];
  const inputPower = calculated.nodes[network.rootId];
  const txX = rootPosition.x;
  const txY = 18;
  const txWidth = 136;
  const txHeight = 46;
  const lines = [
    `<path class="input-path" d="M ${txX} ${txY + txHeight} V ${rootPosition.y - 20}" />`,
    `<g data-select="transmitter" tabindex="0" role="button" aria-label="Transmitter, ${formatNumber(network.txPower, 1)} dBm, ${network.laserFrequency} nanometer">`,
    `<rect class="tx-box ${network.selected.type === 'transmitter' ? 'selected' : ''}" x="${txX - txWidth / 2}" y="${txY}" width="${txWidth}" height="${txHeight}" rx="2" />`,
    `<text class="tx-title" x="${txX}" y="${txY + 16}">Transmitter</text>`,
    `<text class="tx-value" x="${txX}" y="${txY + 31}">${formatNumber(network.txPower, 1)} dBm</text>`,
    `<text class="tx-frequency" x="${txX}" y="${txY + 41}">${network.laserFrequency} nm</text>`,
    '</g>',
    `<text class="edge-distance" x="${txX + 30}" y="${(txY + txHeight + rootPosition.y - 20) / 2}">${formatNumber(network.feederLength, 2)} km</text>`,
    `<text class="power-label" x="${txX + 25}" y="${rootPosition.y - 25}">${formatNumber(inputPower, 2)}</text>`
  ];
  const shapes = [];
  const labels = [];
  const selected = network.selected;
  let outputNumber = 0;

  function visit(id) {
    const node = network.splitters[id];
    const point = positions.nodes[id];
    const isSelected = selected.type === 'splitter' && selected.id === id;
    const ratioText = node.couplerType === 'fbt'
      ? `${node.ratioA}/${100 - node.ratioA}`
      : node.couplerType === 'plc' ? `PLC 1:${node.splitCount}` : 'NO SPLIT';
    shapes.push(
      `<g data-select="splitter" data-id="${id}" class="${isSelected ? 'selected' : ''}" tabindex="0" role="button" aria-label="${node.couplerType === 'none' ? `ODC ${id}, tanpa splitter atau coupler` : `${node.couplerType.toUpperCase()} ${id}, ${ratioText}`}">`,
      `<circle class="splitter-hit ${isSelected ? 'selected' : ''}" cx="${point.x}" cy="${point.y}" r="19" />`,
      `<circle class="splitter-inner" cx="${point.x}" cy="${point.y}" r="14" />`,
      `<text class="splitter-input-power" x="${point.x}" y="${point.y - 24}">${formatNumber(calculated.nodes[id], 2)}</text>`,
      `<text class="splitter-ratio" x="${point.x}" y="${point.y + 2}">${node.couplerType === 'none' ? 'PASS' : node.couplerType === 'fbt' ? 'FBT' : `1:${node.splitCount}`}</text>`,
      `<text class="splitter-ratio-caption" x="${point.x}" y="${point.y + 30}">${ratioText}</text>`,
      '</g>'
    );

    node.ports.forEach((port, portIndex) => {
      const key = `${id}-${portIndex}`;
      const output = positions.ports[key];
      const branchY = point.y + 62;
      const targetY = output.y;
      const targetPower = port.childId
        ? calculated.nodes[port.childId]
        : calculated.outputs[key];
      const isOutputSelected = selected.type === 'output'
        && selected.parentId === id && selected.portIndex === portIndex;
      const endY = port.childId ? targetY + 1 : targetY - 11;
      const route = `M ${point.x} ${point.y + 19} V ${branchY} H ${output.x} V ${endY}`;
      lines.push(`<path class="fiber-path ${isOutputSelected ? 'selected' : ''}" d="${route}" data-select="output" data-parent="${id}" data-port="${portIndex}" />`);
      labels.push(
        `<text class="edge-distance" x="${(point.x + output.x) / 2}" y="${branchY + 13}">${formatNumber(port.length, 2)} km</text>`,
        `<text class="power-label" x="${output.x + (output.x >= point.x ? 15 : -15)}" y="${targetY - 13}" text-anchor="${output.x >= point.x ? 'start' : 'end'}">${formatNumber(targetPower, 2)}</text>`
      );

      if (port.childId) {
        visit(port.childId);
      } else {
        outputNumber += 1;
        shapes.push(
          `<g data-select="output" data-parent="${id}" data-port="${portIndex}" class="${isOutputSelected ? 'selected' : ''}" tabindex="0" role="button" aria-label="Output ${outputNumber}">`,
          `<circle class="output-dot ${isOutputSelected ? 'selected' : ''}" cx="${output.x}" cy="${output.y}" r="12" />`,
          `<text class="output-caption" x="${output.x}" y="${output.y + 27}">OUTPUT ${String(outputNumber).padStart(2, '0')}</text>`,
          '</g>'
        );
      }
    });
  }

  visit(network.rootId);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `${lines[0]}${lines.slice(1).join('')}${labels.join('')}${shapes.join('')}`;
  mapLayout = layout;
  resizeMapCanvas();
  document.querySelector('#map-count').textContent = `${outputCount()} PORT`;
  document.querySelector('#network-summary').textContent = `${splitterCount()} splitter · ${outputCount()} output`;
}

function renderEditor() {
  const selected = network.selected;
  const icon = document.querySelector('#selection-icon');
  const kicker = document.querySelector('#selection-kicker');
  const title = document.querySelector('#selection-title');
  const power = document.querySelector('#selection-power');

  if (selected.type === 'transmitter') {
    icon.textContent = '⌁';
    kicker.textContent = 'TRANSMITTER TERPILIH';
    title.textContent = 'Pengaturan optical link';
    power.textContent = `Optical power ${formatNumber(network.txPower, 1)} dBm`;
    const outputPowers = Object.values(calculated.outputs);
    const weakestOutput = Math.min(...outputPowers);
    const requiredPower = network.minEndSignal + network.safetyMargin;
    const withinBudget = weakestOutput >= requiredPower;
    editorBody.innerHTML = `
      <label class="edit-field">Optical power (dBm)<input type="number" min="-60" max="30" step="0.1" data-global="txPower" value="${network.txPower}" required></label>
      <label class="edit-field">Laser frequency / wavelength (nm)<input type="number" min="700" max="2000" step="1" data-global="laserFrequency" value="${network.laserFrequency}" required></label>
      <label class="edit-field">Loss per km (dB/km)<input type="number" min="0" max="10" step="0.01" data-global="attenuation" value="${network.attenuation}" required></label>
      <label class="edit-field">Min end signal (dBm)<input type="number" min="-60" max="10" step="0.1" data-global="minEndSignal" value="${network.minEndSignal}" required></label>
      <label class="edit-field">Connector loss / link (dB)<input type="number" min="0" max="10" step="0.1" data-global="connectorLoss" value="${network.connectorLoss}" required></label>
      <label class="edit-field">Safety margin (dB)<input type="number" min="0" max="30" step="0.1" data-global="safetyMargin" value="${network.safetyMargin}" required></label>
      <div class="link-assessment ${withinBudget ? 'good' : 'warning'}">
        <strong>${withinBudget ? 'Link memenuhi target' : 'Sinyal di bawah target desain'}</strong>
        <span>Output terlemah ${formatNumber(weakestOutput, 2)} dBm · batas ${formatNumber(network.minEndSignal, 1)} + margin ${formatNumber(network.safetyMargin, 1)} = ${formatNumber(requiredPower, 1)} dBm</span>
      </div>
      <p class="transmitter-help">Laser wavelength ditampilkan dalam nm. Connector loss diterapkan sekali pada setiap link kabel.</p>`;
  } else if (selected.type === 'splitter' && network.splitters[selected.id]) {
    const node = network.splitters[selected.id];
    const parentPort = selected.id === network.rootId ? null : findParentPort(selected.id);
    const incomingLength = parentPort
      ? parentPort.node.ports[parentPort.portIndex].length
      : network.feederLength;
    icon.textContent = '⌘';
    kicker.textContent = 'ODC / COUPLER TERPILIH';
    title.textContent = node.couplerType === 'none'
      ? 'Jalur langsung · tanpa coupler'
      : `ODC · Splitter ${selected.id}`;
    power.textContent = `Input ${formatNumber(calculated.nodes[selected.id], 2)} dBm`;
    const fbtRatios = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    const splitterOptions = [];
    const fbtDisabled = node.ports.slice(2).some((port) => port.childId !== null);
    const noSplitDisabled = node.ports.slice(1).some((port) => port.childId !== null);
    splitterOptions.push(
      `<option value="none" ${node.couplerType === 'none' ? 'selected' : ''} ${noSplitDisabled ? 'disabled' : ''}>Tanpa splitter / coupler</option>`
    );
    const fbtOptions = fbtRatios.map((ratio) => {
      const selectedOption = node.couplerType === 'fbt' && node.ratioA === ratio ? 'selected' : '';
      return `<option value="fbt:${ratio}" ${selectedOption} ${fbtDisabled ? 'disabled' : ''}>${ratio}/${100 - ratio}</option>`;
    }).join('');
    splitterOptions.push(`<optgroup label="FBT Coupler / Rasio (1/99 – 50/50)">${fbtOptions}</optgroup>`);
    const splitterAvailability = new Map();
    for (const count of [2, 4, 8, 16, 32, 64, 128]) {
      const removesConnectedPort = node.ports.slice(count).some((port) => port.childId !== null);
      const proposedTotal = outputCount() - outputCount(selected.id) + outputCountForSplitCount(node, count);
      splitterAvailability.set(count, removesConnectedPort || proposedTotal > MAX_OUTPUTS);
    }
    const plcOptions = [2, 4, 8, 16, 32, 64, 128]
      .map((count) => {
        const selectedOption = node.couplerType === 'plc' && node.splitCount === count ? 'selected' : '';
        const disabled = splitterAvailability.get(count) ? 'disabled' : '';
        return `<option value="plc:${count}" ${selectedOption} ${disabled}>1:${count}</option>`;
      })
      .join('');
    splitterOptions.push(`<optgroup label="PLC Splitter (1:2 – 1:128)">${plcOptions}</optgroup>`);
    editorBody.innerHTML = `
      <label class="edit-field">Cable length to ODC (km)<input type="number" min="${MIN_CABLE_LENGTH}" max="1000" step="0.01" data-setting="incomingLength" value="${incomingLength}" required></label>
      <label class="edit-field">Splitter / coupler<select data-setting="coupler">${splitterOptions.join('')}</select></label>
      ${node.couplerType === 'none' ? '' : `<label class="edit-field">Insertion loss (dB)<input type="number" min="0" max="20" step="0.1" data-setting="loss" value="${node.loss}" required></label>`}
      <span class="editor-message">${node.couplerType === 'none'
        ? 'Mode pass-through: daya diteruskan tanpa pembagian splitter.'
        : node.couplerType === 'fbt'
          ? `FBT membagi daya ${node.ratioA}/${100 - node.ratioA} ke dua port.`
          : `PLC 1:${node.splitCount} membagi daya merata ke ${node.splitCount} port.`}</span>
      <button type="button" class="editor-button danger" data-action="remove" ${selected.id === network.rootId ? 'disabled' : ''}>Hapus splitter</button>`;
  } else {
    const node = network.splitters[selected.parentId];
    if (!node) {
      network.selected = { type: 'splitter', id: network.rootId };
      renderEditor();
      return;
    }
    const portIndex = selected.portIndex;
    const port = node.ports[portIndex];
    if (!port) {
      network.selected = { type: 'splitter', id: network.rootId };
      renderEditor();
      return;
    }
    const child = port.childId;
    icon.textContent = child ? '⌘' : '○';
    kicker.textContent = child ? 'CABANG SPLITTER' : 'OUTPUT TERPILIH';
    title.textContent = child ? `Port ${portIndex + 1} · Splitter ${child}` : `Port ${portIndex + 1} · Splitter ${selected.parentId}`;
    const key = `${selected.parentId}-${portIndex}`;
    const endPower = child ? calculated.nodes[child] : calculated.outputs[key];
    power.textContent = `${formatNumber(endPower, 2)} dBm`;
    editorBody.innerHTML = `
      <label class="edit-field">Panjang kabel (km)<input type="number" min="${MIN_CABLE_LENGTH}" max="1000" step="0.01" data-setting="length" value="${port.length}" required></label>
      ${child
        ? `<button type="button" class="editor-button" data-action="focus-child" data-id="${child}">Atur splitter ${child}</button>`
        : `<button type="button" class="editor-button primary" data-action="add">＋ Tambahkan splitter</button>`}
      <span class="editor-message">${child ? 'Port meneruskan sinyal ke splitter berikutnya.' : `Sisa kapasitas ${MAX_OUTPUTS - outputCount()} output.`}</span>`;
    const addButton = editorBody.querySelector('[data-action="add"]');
    if (addButton) addButton.disabled = outputCount() >= MAX_OUTPUTS;
  }
}

function render() {
  renderMap();
  renderEditor();
  persistNetwork();
}

function getOutputReportRows() {
  updateCalculations();
  const rows = [];
  const requiredPower = network.minEndSignal + network.safetyMargin;
  const rootInput = network.txPower
    - network.attenuation * network.feederLength
    - network.connectorLoss;

  function nodeLabel(node) {
    if (node.couplerType === 'fbt') return `ODC ${node.id} · FBT ${node.ratioA}/${100 - node.ratioA}`;
    if (node.couplerType === 'plc') return `ODC ${node.id} · PLC 1:${node.splitCount}`;
    return `ODC ${node.id} · tanpa coupler`;
  }

  function visit(id, incomingPower, route, cableLength, insertionLoss) {
    const node = network.splitters[id];
    node.ports.forEach((port, index) => {
      const currentInsertionLoss = insertionLoss + getNodeInsertionLoss(node);
      const powerAfterSplit = incomingPower
        + 10 * Math.log10(getPortFraction(node, index))
        - getNodeInsertionLoss(node);
      const outputPower = powerAfterSplit
        - network.attenuation * port.length
        - network.connectorLoss;
      const nextRoute = [...route, nodeLabel(node)];
      const nextLength = cableLength + port.length;

      if (port.childId) {
        visit(port.childId, outputPower, nextRoute, nextLength, currentInsertionLoss);
      } else {
        rows.push({
          output: rows.length + 1,
          topology: [...nextRoute, `Output ${rows.length + 1}`].join(' → '),
          cableLength: nextLength,
          insertionLoss: currentInsertionLoss,
          power: outputPower,
          requiredPower,
          status: outputPower >= requiredPower ? 'Memenuhi target' : 'Di bawah target'
        });
      }
    });
  }

  visit(network.rootId, rootInput, ['Transmitter'], network.feederLength, 0);
  return rows;
}

function csvEscape(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvNumber(value) {
  return Number(value.toFixed(2));
}

function exportCsv() {
  const rows = getOutputReportRows();
  const headers = [
    'Output',
    'Topologi',
    'Total panjang kabel (km)',
    'Loss insertion coupler total (dB)',
    'Daya transmitter (dBm)',
    'Panjang gelombang (nm)',
    'Redaman kabel (dB/km)',
    'Loss konektor per link (dB)',
    'Min end signal (dBm)',
    'Safety margin (dB)',
    'Target daya minimum (dBm)',
    'Daya terima (dBm)',
    'Status'
  ];
  const csvRows = rows.map((row) => [
    row.output,
    row.topology,
    csvNumber(row.cableLength),
    csvNumber(row.insertionLoss),
    csvNumber(network.txPower),
    network.laserFrequency,
    csvNumber(network.attenuation),
    csvNumber(network.connectorLoss),
    csvNumber(network.minEndSignal),
    csvNumber(network.safetyMargin),
    csvNumber(row.requiredPower),
    csvNumber(row.power),
    row.status
  ]);
  const csv = [headers, ...csvRows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const now = new Date();
  const dateStamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  link.href = url;
  link.download = `alea-fiber-plan-report-${dateStamp}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderPrintableReport() {
  const report = document.querySelector('#print-report');
  const rows = getOutputReportRows();
  const weakestOutput = Math.min(...rows.map((row) => row.power));
  const requiredPower = network.minEndSignal + network.safetyMargin;
  const status = weakestOutput >= requiredPower ? 'Memenuhi target' : 'Di bawah target';
  const splitterTypes = { fbt: 0, plc: 0, none: 0 };
  Object.values(network.splitters).forEach((node) => { splitterTypes[node.couplerType] += 1; });
  const timestamp = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(new Date());
  const diagram = svg.cloneNode(true);
  diagram.removeAttribute('width');
  diagram.removeAttribute('height');

  report.innerHTML = `
    <h1>Laporan Perencanaan Fiber Optik</h1>
    <p class="print-meta">Dibuat pada ${escapeHtml(timestamp)} · Alea Fiber Plan</p>
    <div class="print-summary">
      <span><strong>${splitterCount()}</strong> coupler/splitter · <strong>${outputCount()}</strong> output</span>
      <span>FBT: ${splitterTypes.fbt} · PLC: ${splitterTypes.plc}</span>
      <span>Output terlemah: ${formatNumber(weakestOutput, 2)} dBm</span>
      <span class="${weakestOutput >= requiredPower ? 'print-status-good' : 'print-status-warning'}">${status}</span>
    </div>
    <h2>Parameter optical link</h2>
    <div class="print-parameters">
      <p>Daya transmitter: <strong>${formatNumber(network.txPower, 1)} dBm</strong></p>
      <p>Panjang gelombang: <strong>${network.laserFrequency} nm</strong></p>
      <p>Redaman kabel: <strong>${formatNumber(network.attenuation, 2)} dB/km</strong></p>
      <p>Panjang feeder: <strong>${formatNumber(network.feederLength, 2)} km</strong></p>
      <p>Loss konektor per link: <strong>${formatNumber(network.connectorLoss, 2)} dB</strong></p>
      <p>Min end signal: <strong>${formatNumber(network.minEndSignal, 1)} dBm</strong></p>
      <p>Safety margin: <strong>${formatNumber(network.safetyMargin, 1)} dB</strong></p>
      <p>Target daya minimum: <strong>${formatNumber(requiredPower, 1)} dBm</strong></p>
    </div>
    <h2>Diagram topologi</h2>
    <div class="print-diagram">${diagram.outerHTML}</div>
    <h2>Hasil per output</h2>
    <table>
      <thead><tr><th>Output</th><th>Rute</th><th>Kabel total (km)</th><th>Loss coupler (dB)</th><th>Daya terima (dBm)</th><th>Status</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td>${row.output}</td>
          <td>${escapeHtml(row.topology)}</td>
          <td>${formatNumber(row.cableLength, 2)}</td>
          <td>${formatNumber(row.insertionLoss, 2)}</td>
          <td>${formatNumber(row.power, 2)}</td>
          <td class="${row.power >= requiredPower ? 'print-status-good' : 'print-status-warning'}">${row.status}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="print-note">Laporan ini merupakan estimasi perencanaan. Verifikasi loss komponen dengan datasheet dan pengukuran lapangan.</p>`;
}

document.querySelector('#export-csv').addEventListener('click', () => {
  try {
    exportCsv();
  } catch (error) {
    console.error('Laporan CSV tidak dapat diekspor.', error);
    document.querySelector('.save-status').textContent = 'EKSPOR CSV GAGAL';
  }
});

document.querySelector('#export-pdf').addEventListener('click', () => {
  try {
    renderPrintableReport();
    document.querySelector('#print-report').setAttribute('aria-hidden', 'false');
    window.print();
  } catch (error) {
    console.error('Laporan PDF tidak dapat disiapkan.', error);
    document.querySelector('.save-status').textContent = 'EKSPOR PDF GAGAL';
  }
});

window.addEventListener('afterprint', () => {
  document.querySelector('#print-report').setAttribute('aria-hidden', 'true');
});

function updateTransmitterAssessment() {
  const assessment = editorBody.querySelector('.link-assessment');
  if (!assessment) return;
  const weakestOutput = Math.min(...Object.values(calculated.outputs));
  const requiredPower = network.minEndSignal + network.safetyMargin;
  const withinBudget = weakestOutput >= requiredPower;
  assessment.classList.toggle('good', withinBudget);
  assessment.classList.toggle('warning', !withinBudget);
  assessment.querySelector('strong').textContent = withinBudget
    ? 'Link memenuhi target'
    : 'Sinyal di bawah target desain';
  assessment.querySelector('span').textContent =
    `Output terlemah ${formatNumber(weakestOutput, 2)} dBm · batas ${formatNumber(network.minEndSignal, 1)} + margin ${formatNumber(network.safetyMargin, 1)} = ${formatNumber(requiredPower, 1)} dBm`;
}

document.querySelector('#map-zoom-in').addEventListener('click', () => setMapZoom(mapZoom * 1.2));
document.querySelector('#map-zoom-out').addEventListener('click', () => setMapZoom(mapZoom / 1.2));
document.querySelector('#map-zoom-fit').addEventListener('click', () => {
  mapZoom = 1;
  mapScroll.scrollTo({ left: 0, top: 0 });
  resizeMapCanvas();
});

mapScroll.addEventListener('wheel', (event) => {
  event.preventDefault();
  const bounds = mapScroll.getBoundingClientRect();
  setMapZoom(mapZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - bounds.left, event.clientY - bounds.top);
}, { passive: false });

mapScroll.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: mapScroll.scrollLeft,
    scrollTop: mapScroll.scrollTop,
    moved: false
  };
});

mapScroll.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;
  if (!dragState.moved && Math.hypot(deltaX, deltaY) < 4) return;
  if (!dragState.moved) {
    dragState.moved = true;
    mapScroll.classList.add('dragging');
    mapScroll.setPointerCapture(event.pointerId);
  }
  suppressMapClick = true;
  mapScroll.scrollLeft = dragState.scrollLeft - deltaX;
  mapScroll.scrollTop = dragState.scrollTop - deltaY;
});

function finishMapDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  mapScroll.classList.remove('dragging');
  if (mapScroll.hasPointerCapture(event.pointerId)) mapScroll.releasePointerCapture(event.pointerId);
  if (dragState.moved) setTimeout(() => { suppressMapClick = false; }, 0);
  dragState = null;
}

mapScroll.addEventListener('pointerup', finishMapDrag);
mapScroll.addEventListener('pointercancel', finishMapDrag);
new ResizeObserver(resizeMapCanvas).observe(mapScroll);

svg.addEventListener('click', (event) => {
  if (suppressMapClick) {
    suppressMapClick = false;
    return;
  }
  const target = event.target.closest('[data-select]');
  if (!target) return;
  if (target.dataset.select === 'transmitter') {
    network.selected = { type: 'transmitter' };
  } else if (target.dataset.select === 'splitter') {
    network.selected = { type: 'splitter', id: Number(target.dataset.id) };
  } else {
    network.selected = {
      type: 'output',
      parentId: Number(target.dataset.parent),
      portIndex: Number(target.dataset.port)
    };
  }
  render();
});

svg.addEventListener('keydown', (event) => {
  const target = event.target.closest('[data-select]');
  if ((event.key !== 'Enter' && event.key !== ' ') || !target) return;
  event.preventDefault();
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

editorBody.addEventListener('input', (event) => {
  const input = event.target;
  const globalSetting = input.dataset.global;
  if (globalSetting) {
    if (!input.value || !input.checkValidity()) return;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    network[globalSetting] = value;
    const topControlId = {
      txPower: 'tx-power',
      attenuation: 'attenuation'
    }[globalSetting];
    const topControl = topControlId ? document.getElementById(topControlId) : null;
    if (topControl) topControl.value = value;
    renderMap();
    document.querySelector('#selection-power').textContent =
      `Optical power ${formatNumber(network.txPower, 1)} dBm`;
    updateTransmitterAssessment();
    persistNetwork();
    return;
  }
  const setting = input.dataset.setting;
  if (!setting) return;
  if (setting === 'coupler') return;
  if (!input.value || !input.checkValidity()) return;
  input.setCustomValidity('');
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  if (network.selected.type === 'splitter') {
    const node = network.splitters[network.selected.id];
    if (setting === 'incomingLength') {
      const parentPort = network.selected.id === network.rootId
        ? null
        : findParentPort(network.selected.id);
      if (parentPort) parentPort.node.ports[parentPort.portIndex].length = value;
      else {
        network.feederLength = value;
        document.querySelector('#feeder-length').value = value;
      }
    } else {
      node[setting] = value;
    }
  } else {
    const node = network.splitters[network.selected.parentId];
    if (setting === 'length') node.ports[network.selected.portIndex].length = value;
  }
  renderMap();
  const powerText = network.selected.type === 'splitter'
    ? `Input ${formatNumber(calculated.nodes[network.selected.id], 2)} dBm`
    : `${formatNumber(calculated.outputs[`${network.selected.parentId}-${network.selected.portIndex}`] ?? calculated.nodes[network.splitters[network.selected.parentId].ports[network.selected.portIndex].childId], 2)} dBm`;
  document.querySelector('#selection-power').textContent = powerText;
  const editorMessage = editorBody.querySelector('.editor-message');
  if (editorMessage && network.selected.type === 'splitter') {
    editorMessage.textContent = `Rasio membagi daya ke port 1 dan kumpulan port 2–${network.splitters[network.selected.id].splitCount}.`;
  }
  persistNetwork();
});

editorBody.addEventListener('change', (event) => {
  if (event.target.dataset.global) {
    const input = event.target;
    const value = Number(input.value);
    if (!Number.isFinite(value) || !input.checkValidity()) {
      input.setCustomValidity('Periksa kembali nilai yang dimasukkan.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    network[input.dataset.global] = value;
    render();
    return;
  }
  if (!event.target.dataset.setting) return;
  const input = event.target;
  if (input.dataset.setting === 'coupler') {
    const node = network.splitters[network.selected.id];
    if (input.value === 'none') {
      node.couplerType = 'none';
      node.splitCount = 1;
      node.ratioA = 100;
      node.loss = 0;
      node.ports = node.ports.slice(0, 1);
    } else {
      const [type, value] = input.value.split(':');
      const selectedValue = Number(value);
      if (!Number.isInteger(selectedValue)) return;
      node.couplerType = type;
      node.splitCount = type === 'fbt' ? 2 : selectedValue;
      node.ratioA = type === 'fbt' ? selectedValue : 50;
      node.ports = node.ports.slice(0, node.splitCount);
      while (node.ports.length < node.splitCount) {
        node.ports.push({ length: MIN_CABLE_LENGTH, childId: null });
      }
    }
    render();
    return;
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || !input.checkValidity()) {
    input.setCustomValidity('Periksa kembali nilai yang dimasukkan.');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  if (network.selected.type === 'splitter') {
    const node = network.splitters[network.selected.id];
    if (input.dataset.setting === 'incomingLength') {
      const parentPort = network.selected.id === network.rootId
        ? null
        : findParentPort(network.selected.id);
      if (parentPort) parentPort.node.ports[parentPort.portIndex].length = value;
      else {
        network.feederLength = value;
        document.querySelector('#feeder-length').value = value;
      }
    } else {
      node[input.dataset.setting] = value;
    }
  } else {
    if (input.dataset.setting === 'length') {
      network.splitters[network.selected.parentId].ports[network.selected.portIndex].length = value;
    }
  }
  render();
});

editorBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;

  if (action === 'add' && network.selected.type === 'output' && outputCount() < MAX_OUTPUTS) {
    const parent = network.splitters[network.selected.parentId];
    const portIndex = network.selected.portIndex;
    const id = network.nextId;
    network.nextId += 1;
    network.splitters[id] = {
      id,
      couplerType: 'fbt',
      splitCount: 2,
      ratioA: 50,
      loss: 0,
      ports: [
        { length: MIN_CABLE_LENGTH, childId: null },
        { length: MIN_CABLE_LENGTH, childId: null }
      ]
    };
    parent.ports[portIndex].childId = id;
    network.selected = { type: 'splitter', id };
  }

  if (action === 'focus-child') {
    network.selected = { type: 'splitter', id: Number(button.dataset.id) };
  }

  if (action === 'remove' && network.selected.type === 'splitter' && network.selected.id !== network.rootId) {
    const removeBranch = (parentId) => {
      const parent = network.splitters[parentId];
      for (const port of parent.ports) {
        if (port.childId === network.selected.id) {
          const deleteTree = (id) => {
            const node = network.splitters[id];
            if (!node) return;
            node.ports.forEach((childPort) => {
              if (childPort.childId) deleteTree(childPort.childId);
            });
            delete network.splitters[id];
          };
          deleteTree(network.selected.id);
          port.childId = null;
          network.selected = { type: 'splitter', id: parentId };
          return true;
        }
        if (port.childId && removeBranch(port.childId)) return true;
      }
      return false;
    };
    removeBranch(network.rootId);
  }

  render();
});

for (const [elementId, setting] of [
  ['tx-power', 'txPower'],
  ['attenuation', 'attenuation'],
  ['feeder-length', 'feederLength']
]) {
  const input = document.getElementById(elementId);
  input.value = network[setting];
  input.addEventListener('input', () => {
    if (!input.value || !input.checkValidity()) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    network[setting] = value;
    renderMap();
    const transmitterInput = editorBody.querySelector(`[data-global="${setting}"]`);
    if (transmitterInput) transmitterInput.value = value;
    const incomingLengthInput = editorBody.querySelector('[data-setting="incomingLength"]');
    if (setting === 'feederLength' && network.selected.type === 'splitter'
      && network.selected.id === network.rootId && incomingLengthInput) {
      incomingLengthInput.value = value;
    }
    if (network.selected.type === 'splitter') {
      document.querySelector('#selection-power').textContent =
        `Input ${formatNumber(calculated.nodes[network.selected.id], 2)} dBm`;
    } else if (network.selected.type === 'output') {
      document.querySelector('#selection-power').textContent =
        `${formatNumber(calculated.outputs[`${network.selected.parentId}-${network.selected.portIndex}`] ?? calculated.nodes[network.splitters[network.selected.parentId].ports[network.selected.portIndex].childId], 2)} dBm`;
    } else {
      document.querySelector('#selection-power').textContent =
        `Optical power ${formatNumber(network.txPower, 1)} dBm`;
      updateTransmitterAssessment();
    }
    persistNetwork();
  });
}

document.querySelector('#reset-network').addEventListener('click', () => {
  if (!window.confirm('Atur ulang diagram dan semua nilai ke pengaturan awal?')) return;
  network = cloneDefault();
  mapZoom = 1;
  mapScroll.scrollTo({ left: 0, top: 0 });
  for (const [elementId, setting] of [
    ['tx-power', 'txPower'],
    ['laser-frequency', 'laserFrequency'],
    ['attenuation', 'attenuation'],
    ['feeder-length', 'feederLength'],
    ['min-end-signal', 'minEndSignal'],
    ['connector-loss', 'connectorLoss'],
    ['safety-margin', 'safetyMargin']
  ]) {
    const input = document.getElementById(elementId);
    if (input) input.value = network[setting];
  }
  render();
});

render();
