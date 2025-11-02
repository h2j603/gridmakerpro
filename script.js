// --- [신규] 글로벌 상태 변수 ---
let layers = []; 
let activeLayerId = null;
let selectedModuleId = null;

// --- [수정] 글로벌 설정 (공통 뷰 상태) ---
let currentView = 'desktop', activeTab = 'html';
let showSelection = true;
let dimInactiveLayers = true; 

// --- [신규] 드래그 상태 변수 ---
let draggedModuleInfo = null; 

// --- [신규] 히스토리 변수 (레이어 구조 전체 저장) ---
let history = [];
let historyIndex = -1;

// --- [신규] 헬퍼: 깊은 복사 ---
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// --- [신규] 헬퍼: HTML 이스케이프 (XSS 방지) ---
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  // [수정] 줄바꿈 유지를 위해 \n을 <br>로 변환
  str = str.replace(/\n/g, '<br>');
  return str.replace(/[&<>"']/g, function(m) {
     return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}
// [신규] HTML 디코드 (textarea용)
function decodeHTML(str) {
    if (str === null || str === undefined) return '';
    // <br>을 다시 \n으로
    str = str.replace(/<br\s*\/?>/g, '\n');
    let txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
}


// --- [신규] 헬퍼: 활성 레이어 가져오기 ---
function getActiveLayer() {
  if (!activeLayerId) return null;
  return layers.find(l => l.id === activeLayerId);
}

// --- [신규] 헬퍼: 선택된 모듈 가져오기 ---
function getSelectedModule() {
  const layer = getActiveLayer();
  if (!layer || selectedModuleId === null) return null;
  const module = layer.modules.find(m => m.id === selectedModuleId);
  if (!module) {
    selectedModuleId = null;
    return null;
  }
  return { module, layer }; 
}

// --- [신규] 헬퍼: Clamp ---
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

// --- [신규] 헬퍼: 정렬된 레이어 반환 ---
function getSortedLayers() {
  // 우선순위 번호(오름차순)에 따라 레이어 정렬
  // 번호가 낮은 것이 캔버스에서 더 '아래'에 깔림 (먼저 렌더링됨)
  return [...layers].sort((a, b) => a.priority - b.priority);
}

// === [신규] 상태 저장 (Undo/Redo) ===
function saveState() {
  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  const state = {
    layers: deepCopy(layers),
    activeLayerId: activeLayerId,
    selectedModuleId: selectedModuleId
  };
  history.push(state);
  historyIndex = history.length - 1;
  if (history.length > 100) {
    history.shift();
    historyIndex--;
  }
  updateUndoRedoButtons();
}

// === [신규] 상태 불러오기 (Undo/Redo) ===
function loadState(state) {
  if (!state) return;
  
  layers = deepCopy(state.layers);
  activeLayerId = state.activeLayerId;
  selectedModuleId = state.selectedModuleId;

  if (!getActiveLayer() && layers.length > 0) {
      const sortedLayers = getSortedLayers();
      activeLayerId = sortedLayers[sortedLayers.length - 1].id;
  }
  
  renderAll(); 
  loadSettingsToUI(getActiveLayer()); 
  updateEditPanel();
  updateUndoRedoButtons();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    loadState(history[historyIndex]);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    loadState(history[historyIndex]);
  }
}

function updateUndoRedoButtons() {
  document.getElementById('undo-btn').disabled = (historyIndex <= 0);
  document.getElementById('redo-btn').disabled = (historyIndex >= history.length - 1);
}

// === [신규] 전체 UI 렌더링 ===
function renderAll() {
  renderLayersList();
  renderCanvas();
  updateStats();
  updateCode();
  updateAddModuleHint();
}

// === [수정] 레이어 패널 렌더링 (우선순위 입력 방식) ===
function renderLayersList() {
  const list = document.getElementById('layer-list');
  if (!list) return;
  
  list.innerHTML = getSortedLayers().map(layer => `
    <li class="layer-item ${layer.id === activeLayerId ? 'active' : ''} ${layer.isLocked ? 'locked' : ''}" 
        onclick="activateLayer(${layer.id})">
      
      <input 
        type="number" 
        class="layer-priority" 
        value="${layer.priority}" 
        onclick="event.stopPropagation()" 
        onchange="updateLayerPriority(event, ${layer.id})">
      
      <button class="layer-btn" onclick="toggleLayerVisibility(event, ${layer.id})">
        ${layer.isVisible ? '👁️' : '🙈'}
      </button>
      <span class="layer-name" 
            contenteditable="true" 
            onblur="renameLayer(event, ${layer.id})"
            onkeydown="handleLayerRenameKey(event)">${layer.name}</span>
      <button class="layer-btn layer-btn-lock" onclick="toggleLayerLock(event, ${layer.id})">
        ${layer.isLocked ? '🔒' : '🔓'}
      </button>
    </li>
  `).join('');
}


// === [수정] 캔버스 렌더링 (Box/Text 통합 및 폰트 굵기) ===
function renderCanvas() {
  const viewport = document.getElementById('canvas-viewport');
  if (!viewport) return;
  
  const scaleValue = parseInt(document.getElementById('canvas-scale').value);
  viewport.style.transform = `scale(${scaleValue / 100})`;
  viewport.classList.toggle('mobile-view', currentView === 'mobile');
  viewport.classList.toggle('selection-hidden', !showSelection);
  
  const selectedModuleInfo = getSelectedModule();
  const selectedGroupId = (selectedModuleInfo && selectedModuleInfo.module.groupId) ? selectedModuleInfo.module.groupId : null;

  // [수정] 정렬된 레이어 순서대로 렌더링 (Z-index 결정)
  viewport.innerHTML = getSortedLayers().map(layer => {
    if (!layer.isVisible) return `<div class="grid-container hidden" id="grid-${layer.id}"></div>`;
    
    const { settings } = layer;
    const columns = currentView === 'desktop' ? settings.desktopColumns : settings.targetColumns;
    const gap = currentView === 'desktop' ? settings.desktopGap : settings.mobileGap;
    const isActive = layer.id === activeLayerId;
    const isLocked = layer.isLocked;
    const opacityStyle = (!isActive && dimInactiveLayers) ? 'opacity: 0.4;' : '';
    const order = currentView === 'desktop' ? layer.desktopOrder : layer.mobileOrder;
    const orderedModules = order.map(id => layer.modules.find(m => m.id === id)).filter(m => m);

    const modulesHTML = orderedModules.map((moduleData, i) => {
      const isSelected = isActive && moduleData.id === selectedModuleId;
      const isTransparent = moduleData.transparent || false;
      const bgColor = isTransparent ? 'transparent' : (moduleData.color || '#8c6c3c');
      const borderWidth = moduleData.borderWidth || 0;
      const borderColor = moduleData.borderColor || '#000000';
      const outlineStyle = borderWidth > 0 ? `outline: ${borderWidth}px solid ${borderColor}; outline-offset: -${borderWidth}px;` : '';
      const desktopColSpan = clamp(moduleData.col, 1, settings.desktopColumns);
      const mobileColSpan = getMobileSpan(moduleData, layer);
      const col = currentView === 'desktop' ? desktopColSpan : mobileColSpan;
      const showWarning = currentView === 'mobile' && 
                          moduleData.col > settings.targetColumns && 
                          (moduleData.mobileCol === null || moduleData.mobileCol === undefined || moduleData.mobileCol === '');
      
      let innerHTML = '';
      const moduleType = moduleData.type || 'box'; // [수정] 'text'는 'box'로 통합

      let textStyles = '';
      let moduleFlexStyles = '';
            
      // [수정] 'box' 타입이 텍스트를 렌더링하도록 변경
      if (moduleType === 'box') { 
        textStyles = `
          text-align: ${moduleData.textAlign || 'left'};
          color: ${moduleData.fontColor || '#000000'};
          font-size: ${moduleData.fontSize ? moduleData.fontSize + 'px' : '14px'};
          font-weight: ${moduleData.fontWeight || '400'}; /* [신규] 폰트 굵기 적용 */
          width: 100%; 
          margin: 0; 
        `;
        moduleFlexStyles = `
          display: flex;
          align-items: ${moduleData.verticalAlign || 'flex-start'};
          padding: 10px; 
        `;
        // [수정] 텍스트 내용이 있을 때만 P 태그 생성
        if (moduleData.textContent) {
          innerHTML = `<p class="module-content" style="${textStyles}">${escapeHTML(moduleData.textContent)}</p>`; 
        }
      } 
      else if (moduleType === 'image') { 
        innerHTML = `<img src="https://via.placeholder.com/${desktopColSpan * 100}x${moduleData.row * 50}" alt="placeholder" class="module-content image">`; 
      }
      
      const selectedClass = (showSelection && isSelected) ? 'selected' : '';
      const groupedClass = (showSelection && selectedGroupId && moduleData.groupId === selectedGroupId && !isSelected) ? 'grouped' : '';
      const aspectStyle = moduleData.aspectRatio ? `aspect-ratio: ${moduleData.aspectRatio};` : '';

      // [수정] 배경색 로직: 'box'는 bgColor, 'image'는 회색 플레이스홀더
      const moduleBackground = (moduleType === 'box') ? bgColor : '#e0e0e0';

      return `
      <div class="module ${selectedClass} ${groupedClass} ${showWarning ? 'warning' : ''}" 
           style="grid-column: span ${col}; grid-row: span ${moduleData.row}; background: ${moduleBackground}; ${outlineStyle} ${aspectStyle} ${moduleFlexStyles}"
           data-type="${moduleType}"
           data-group-id="${moduleData.groupId || ''}"
           data-module-info="${layer.id},${moduleData.id},${i}"
           onclick="selectModule(${layer.id}, ${moduleData.id})"
           ondragover="handleDragOver(event)"
           ondrop="handleDrop(${layer.id}, ${i}, event)">
        ${innerHTML} 
        <div class="module-info">${moduleData.col}×${moduleData.row}</div>
        ${showWarning ? '<div class="module-warning">!</div>' : ''}
        <button class="module-delete" onclick="deleteModule(${layer.id}, ${moduleData.id}, event)">×</button>
        <div class="module-drag-handle" 
             draggable="true" 
             ondragstart="handleDragStart(${layer.id}, ${moduleData.id}, ${i}, event)" 
             ondragend="handleDragEnd(event)"
             onmousedown="handleDragStart(${layer.id}, ${moduleData.id}, ${i}, event)"
             ontouchstart="handleModuleTouchStart(event, ${layer.id}, ${moduleData.id}, ${i})">⠿</div>
      </div>
    `}).join('');
    
    return `
      <div class="grid-container ${isActive ? 'active-layer' : ''} ${isLocked ? 'locked' : ''} ${!layer.isVisible ? 'hidden' : ''}"
           id="grid-${layer.id}"
           style="grid-template-columns: repeat(${columns}, 1fr); gap: ${gap}px; mix-blend-mode: ${layer.settings.blendMode || 'normal'}; ${opacityStyle}; isolation: isolate;"
           ondragover="${isActive && !isLocked ? 'handleDragOver(event)' : ''}"
           ondrop="${isActive && !isLocked ? 'handleDrop(${layer.id}, null, event)' : ''}">
        ${modulesHTML}
      </div>
    `;
  }).join('');
}

// === [신규] 레이어 우선순위 관리 함수 ===
function updateLayerPriority(event, layerId) {
  event.stopPropagation();
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  
  layer.priority = parseFloat(event.target.value) || 0;
  
  normalizeLayerPriorities();
  
  saveState();
  renderLayersList(); 
  renderCanvas();     
  updateCode();
}

function normalizeLayerPriorities() {
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);
  
  sorted.forEach((layer, index) => {
    const originalLayer = layers.find(l => l.id === layer.id);
    if (originalLayer) {
      originalLayer.priority = index;
    }
  });
}


// === [신규] 레이어 관리 함수 ===
function addLayer() {
  const newName = `Layer ${layers.length + 1}`;
  const newPriority = layers.length > 0 ? Math.max(...layers.map(l => l.priority)) + 1 : 0;

  const newLayer = {
    id: Date.now(),
    name: newName,
    priority: newPriority, 
    modules: [],
    desktopOrder: [],
    mobileOrder: [],
    isVisible: true,
    isLocked: false,
    settings: {
      desktopColumns: 6,
      desktopGap: 10,
      targetColumns: 2,
      mobileGap: 10,
      mobileOrderLocked: false,
      blendMode: 'normal' 
    }
  };
  layers.push(newLayer);
  
  activateLayer(newLayer.id); 
  showToast(`${newName} 추가됨`);
}

function deleteActiveLayer() {
  if (layers.length <= 1) {
    showToast('마지막 레이어는 삭제할 수 없습니다.');
    return;
  }
  const layer = getActiveLayer();
  if (!layer) return;
  if (confirm(`'${layer.name}' 레이어를 삭제하시겠습니까?`)) {
    layers = layers.filter(l => l.id !== layer.id);
    activeLayerId = getSortedLayers()[getSortedLayers().length - 1].id;
    selectedModuleId = null;

    normalizeLayerPriorities();

    renderAll();
    loadSettingsToUI(getActiveLayer()); 
    updateEditPanel();
    saveState();
    showToast(`레이어 삭제됨`);
  }
}

function activateLayer(layerId) {
    if (activeLayerId === layerId) return; 
    activeLayerId = layerId;
    selectedModuleId = null; 
    
    const newActiveLayer = getActiveLayer();
    
    loadSettingsToUI(newActiveLayer);
    
    renderLayersList();
    renderCanvas();
    updateEditPanel();
    updateStats();
    updateAddModuleHint();
}

function renameLayer(event, layerId) {
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  const newName = event.target.textContent.trim();
  if (newName && layer.name !== newName) {
    layer.name = newName;
    event.target.textContent = newName;
    saveState();
    showToast('레이어 이름 변경됨');
  } else {
    event.target.textContent = layer.name;
  }
}

function handleLayerRenameKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
    }
}

function toggleLayerVisibility(event, layerId) {
  event.stopPropagation();
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  layer.isVisible = !layer.isVisible;
  renderLayersList();
  renderCanvas();
  saveState();
}

function toggleLayerLock(event, layerId) {
  event.stopPropagation();
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  layer.isLocked = !layer.isLocked;
  renderLayersList();
  updateAddModuleHint();
  saveState();
}


// === [수정] 모듈 관리 함수 (Box/Text 통합 및 폰트 굵기) ===

function addCustomModule() {
  const layer = getActiveLayer();
  if (!layer) { showToast('활성 레이어가 없습니다.'); return; }
  if (layer.isLocked) { showToast('잠긴 레이어에는 추가할 수 없습니다.'); return; }

  const col = clamp(parseInt(document.getElementById('custom-col').value) || 2, 1, layer.settings.desktopColumns);
  const row = clamp(parseInt(document.getElementById('custom-row').value) || 2, 1, 99);
  const color = document.getElementById('custom-color').value;
  const transparent = document.getElementById('custom-transparent').checked;
  const borderColor = document.getElementById('custom-border-color').value;
  const borderWidth = clamp(parseInt(document.getElementById('custom-border-width').value) || 0, 0, 20);
  const type = document.getElementById('custom-type').value; 

  // [신규] 텍스트 옵션 읽기
  const textContent = document.getElementById('custom-text-content').value || '';
  const textAlign = document.getElementById('custom-text-align').value;
  const verticalAlign = document.getElementById('custom-vertical-align').value;
  const fontWeight = document.getElementById('custom-font-weight').value;
  const fontColor = document.getElementById('custom-font-color').value;
  const fontSize = document.getElementById('custom-font-size').value;
  
  const newModule = { 
    col, row, color, transparent, borderColor, borderWidth, 
    mobileCol: null, id: Date.now(),
    type: type, 
    groupId: null,
    aspectRatio: null,
    // [수정] 텍스트 속성 (입력값으로)
    textContent: type === 'box' ? textContent : '',
    textAlign: type === 'box' ? textAlign : 'left',
    verticalAlign: type === 'box' ? verticalAlign : 'flex-start',
    fontColor: type === 'box' ? fontColor : '#000000',
    fontSize: type === 'box' ? (fontSize ? parseInt(fontSize) : null) : null,
    fontWeight: type === 'box' ? fontWeight : '400' // [신규]
  };
  
  layer.modules.push(newModule);
  layer.desktopOrder.push(newModule.id);
  if (layer.settings.mobileOrderLocked) {
    layer.mobileOrder = [...layer.desktopOrder];
  } else {
    layer.mobileOrder.push(newModule.id);
  }
  
  // [신규] 추가 후 텍스트 입력란 비우기
  document.getElementById('custom-text-content').value = '';
  document.getElementById('custom-font-size').value = '';
  document.getElementById('custom-transparent').checked = false;
  toggleColorPicker('custom', false);
  document.getElementById('custom-border-width').value = 0;

  showToast(`${col}×${row} ${type} 모듈이 ${layer.name}에 추가됨`);
  renderCanvas();
  updateStats();
  updateCode();
  saveState();
}

function selectModule(layerId, moduleId) {
    if (draggedModuleInfo) return;
    
    if (activeLayerId !== layerId) {
        activateLayer(layerId);
    }
    if (selectedModuleId === moduleId) return; 
    selectedModuleId = moduleId;
    
    updateEditPanel();
    renderCanvas();
}

function deselectModule() {
  if (selectedModuleId !== null) {
    selectedModuleId = null;
    updateEditPanel();
    renderCanvas();
  }
}

function deleteModule(layerId, moduleId, event) {
  event.stopPropagation();
  
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  if (layer.isLocked) {
      showToast('잠긴 레이어의 모듈은 삭제할 수 없습니다.');
      return;
  }

  layer.modules = layer.modules.filter(m => m.id !== moduleId);
  layer.desktopOrder = layer.desktopOrder.filter(id => id !== moduleId);
  layer.mobileOrder = layer.mobileOrder.filter(id => id !== moduleId);

  if(selectedModuleId === moduleId) {
    selectedModuleId = null;
    updateEditPanel();
  }
  
  renderCanvas();
  updateStats();
  updateCode();
  saveState();
}

function deleteSelectedModule() {
  const moduleInfo = getSelectedModule();
  if (!moduleInfo) return;
  deleteModule(moduleInfo.layer.id, moduleInfo.module.id, new Event('click'));
}

function splitSelectedModule() {
  const moduleInfo = getSelectedModule();
  if (!moduleInfo) { showToast('분할할 모듈을 먼저 선택하세요.'); return; }

  const { module, layer } = moduleInfo;
  if (layer.isLocked) { showToast('잠긴 레이어의 모듈은 분할할 수 없습니다.'); return; }

  const h = parseInt(document.getElementById('split-h').value) || 1;
  const v = parseInt(document.getElementById('split-v').value) || 1;

  if (h === 1 && v === 1) return;

  // [수정] 모듈 스플릿 나누어 떨어지지 않는 문제 해결
  if (module.col % h !== 0 || module.row % v !== 0) {
     if (!confirm(`선택한 모듈(${module.col}x${module.row})이 ${h}x${v}로 정확히 나누어 떨어지지 않습니다. \n일부 모듈이 더 작거나 크게 생성될 수 있습니다. 계속할까요?`)) {
       return;
     }
  }

  const baseCol = Math.floor(module.col / h);
  const remainderCol = module.col % h;
  const baseRow = Math.floor(module.row / v);
  const remainderRow = module.row % v;

  const newGroupId = 'split-' + Date.now();
  let newModules = [];
  let newModuleIds = [];

  for (let r = 0; r < v; r++) { 
    const newRow = baseRow + (r < remainderRow ? 1 : 0);
    if (newRow === 0) continue; // 크기가 0인 모듈 생성 방지
    for (let c = 0; c < h; c++) { 
      const newCol = baseCol + (c < remainderCol ? 1 : 0);
      if (newCol === 0) continue; // 크기가 0인 모듈 생성 방지

      const newModule = {
        ...deepCopy(module), // [중요] 텍스트 속성도 여기서 복사됨
        id: Date.now() + (r * h + c),
        col: newCol, 
        row: newRow, 
        groupId: newGroupId,
      };
      newModules.push(newModule);
      newModuleIds.push(newModule.id);
    }
  }

  if (newModules.length === 0) {
    showToast('분할할 수 없는 크기입니다.');
    return;
  }

  const originalIndex = layer.modules.findIndex(m => m.id === module.id);
  if (originalIndex > -1) { layer.modules.splice(originalIndex, 1, ...newModules); }
  const desktopOrderIndex = layer.desktopOrder.indexOf(module.id);
  if (desktopOrderIndex > -1) { layer.desktopOrder.splice(desktopOrderIndex, 1, ...newModuleIds); }
  const mobileOrderIndex = layer.mobileOrder.indexOf(module.id);
  if (mobileOrderIndex > -1) { layer.mobileOrder.splice(mobileOrderIndex, 1, ...newModuleIds); }

  selectedModuleId = null;
  updateEditPanel();
  showToast(`${module.col}x${module.row} 모듈을 ${h}x${v}로 분할했습니다.`);
  renderCanvas();
  updateStats();
  updateCode();
  saveState();
}


function clearActiveLayer() {
  const layer = getActiveLayer();
  if (!layer) return;
  if (layer.isLocked) { showToast('잠긴 레이어는 비울 수 없습니다.'); return; }
  if(confirm(`'${layer.name}' 레이어의 모든 모듈을 삭제하시겠습니까?`)) {
    layer.modules = [];
    layer.desktopOrder = [];
    layer.mobileOrder = [];
    selectedModuleId = null;
    updateEditPanel();
    showToast('활성 레이어 전체 삭제');
    renderCanvas();
    updateStats();
    updateCode();
    saveState();
  }
}

// === [수정] 모듈 드래그 앤 드롭 (마우스/터치) ===

function handleDragStart(layerId, moduleId, moduleIndexInOrder, event) {
    if (event.type === 'mousedown') {
        event.preventDefault(); 
    }
  const layer = layers.find(l => l.id === layerId);
  if (!layer || layer.isLocked) { event.preventDefault(); return; }
  
  draggedModuleInfo = { layerId, moduleId, moduleIndexInOrder };
  const targetModule = event.target.closest('.module');
  if (targetModule) {
    targetModule.classList.add('dragging');
  }
  if(event.type === 'dragstart' && event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', moduleId);
  }
}

function handleDragEnd(event) {
  document.querySelectorAll('.module.dragging').forEach(el => el.classList.remove('dragging'));
  draggedModuleInfo = null;
}

function handleDragOver(event) {
  event.preventDefault();
  if(event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleDrop(targetLayerId, targetModuleIndexInOrder, event) {
  event.preventDefault();
  event.stopPropagation();
  
  if (!draggedModuleInfo || draggedModuleInfo.layerId !== targetLayerId) {
      draggedModuleInfo = null;
      return; 
  }
  
  const layer = layers.find(l => l.id === targetLayerId);
  if (!layer || layer.isLocked) return;
  
  document.querySelectorAll('.module.dragging').forEach(el => el.classList.remove('dragging'));

  const order = currentView === 'desktop' ? layer.desktopOrder : layer.mobileOrder;
  const draggedId = draggedModuleInfo.moduleId;
  const draggedModule = layer.modules.find(m => m.id === draggedId);
  if (!draggedModule) return;
  
  const groupId = draggedModule.groupId;
  let idsToMove = [];
  
  if (groupId) {
      idsToMove = order.filter(id => {
          const m = layer.modules.find(mod => mod.id === id);
          return m && m.groupId === groupId;
      });
  } else {
      idsToMove.push(draggedId);
  }

  if (targetModuleIndexInOrder === null) {
      if (!groupId) { 
          let newOrder = order.filter(id => id !== draggedId);
          newOrder.push(draggedId);
          if (currentView === 'desktop') {
              layer.desktopOrder = newOrder;
              if (layer.settings.mobileOrderLocked) layer.mobileOrder = [...newOrder];
          } else {
              layer.mobileOrder = newOrder;
          }
          renderCanvas();
          updateCode();
          saveState();
      }
      draggedModuleInfo = null;
      return;
  }
  
  const targetId = order[targetModuleIndexInOrder];
  if (idsToMove.includes(targetId)) {
      draggedModuleInfo = null;
      return;s
  }

  let newOrder = order.filter(id => !idsToMove.includes(id));
  let newDropIndex = newOrder.indexOf(targetId);
  
  if (draggedModuleInfo.moduleIndexInOrder < targetModuleIndexInOrder) {
      newDropIndex += 1;
  }

  newOrder.splice(newDropIndex, 0, ...idsToMove);

  if (currentView === 'desktop') {
    layer.desktopOrder = newOrder;
    if (layer.settings.mobileOrderLocked) {
      layer.mobileOrder = [...layer.desktopOrder];
    }
  } else {
    layer.mobileOrder = newOrder;
  }
  
  renderCanvas();
  updateCode();
  saveState();
  draggedModuleInfo = null;
}

// [수정] 모듈 터치 핸들러 (전역 리스너 사용)
function handleModuleTouchStart(event, layerId, moduleId, index) {
    event.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (!layer || layer.isLocked) { return; }
    
    draggedModuleInfo = { layerId, moduleId, moduleIndexInOrder: index };
    event.target.closest('.module').classList.add('dragging');
    
    document.addEventListener('touchmove', handleDocumentTouchMove, { passive: false });
    document.addEventListener('touchend', handleDocumentTouchEnd);
}

function handleDocumentTouchMove(event) {
    if (!draggedModuleInfo) return;
    event.preventDefault(); 
}

function handleDocumentTouchEnd(event) {
    if (draggedModuleInfo) {
        event.stopPropagation();
        const touch = event.changedTouches[0];
        const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);

        const targetModule = targetElement ? targetElement.closest('.module[data-module-info]') : null;
        const targetGrid = targetElement ? targetElement.closest('.grid-container[id^="grid-"]') : null;

        let dropped = false;
        if (targetModule) {
            const moduleInfo = targetModule.dataset.moduleInfo.split(',').map(Number);
            const targetLayerId = moduleInfo[0];
            const targetModuleIndex = moduleInfo[2];
            
            // 'handleDrop'의 시그니처가 (targetLayerId, targetModuleIndex, event)이므로
            // event 객체를 마지막에 전달합니다.
            handleDrop(targetLayerId, targetModuleIndex, event); 
            dropped = true;
        } else if (targetGrid) {
            const targetLayerId = parseInt(targetGrid.id.split('-')[1]);
            handleDrop(targetLayerId, null, event); 
            dropped = true;
        }

        if (!dropped) {
            document.querySelectorAll('.module.dragging').forEach(el => el.classList.remove('dragging'));
            draggedModuleInfo = null;
        }
    }

    document.removeEventListener('touchmove', handleDocumentTouchMove);
    document.removeEventListener('touchend', handleDocumentTouchEnd);
}

// === [신규] 누락되었던 유틸리티 함수 ===

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

function toggleColorPicker(prefix, isTransparent) {
  const colorEl = document.getElementById(`${prefix}-color`);
  if (colorEl) {
    colorEl.disabled = isTransparent;
    colorEl.style.opacity = isTransparent ? 0.3 : 1;
  }
}

function getMobileSpan(moduleData, layer) {
  if (moduleData.mobileCol && moduleData.mobileCol !== '') {
    return clamp(parseInt(moduleData.mobileCol), 1, layer.settings.targetColumns);
  }
  // 모바일 컬럼이 비어있으면, 데스크톱 비율을 유지하되 최대 모바일 컬럼을 넘지 않게 계산
  const desktopColumns = layer.settings.desktopColumns;
  const targetColumns = layer.settings.targetColumns;
  
  // 자동 계산: (모듈의 데스크톱 span / 전체 데스크톱 컬럼) * 전체 모바일 컬럼
  // 예: (3 / 6) * 2 = 1
  // 예: (6 / 6) * 2 = 2
  // 예: (4 / 6) * 2 = 1.333 -> 2 (ceil)
  let calculatedSpan = Math.ceil((moduleData.col / desktopColumns) * targetColumns);
  return clamp(calculatedSpan, 1, targetColumns);
}

function updateAddModuleHint() {
    const hint = document.getElementById('add-module-hint');
    const btn = document.getElementById('add-module-btn');
    const layer = getActiveLayer();
    if (!layer) {
        hint.textContent = '레이어를 먼저 선택하세요.';
        btn.disabled = true;
        return;
    }
    if (layer.isLocked) {
        hint.textContent = `🔒 '${layer.name}' 레이어가 잠겨있습니다.`;
        btn.disabled = true;
    } else {
        hint.textContent = `✅ '${layer.name}' 레이어에 추가됩니다.`;
        btn.disabled = false;
    }
}


// === [신규] UI 토글 함수 ===

function toggleCustomOptions() {
  const type = document.getElementById('custom-type').value;
  const textOptions = document.getElementById('custom-text-options');
  if (type === 'box') {
    textOptions.style.display = 'block';
  } else {
    textOptions.style.display = 'none';
  }
}

function toggleEditOptions() {
  const type = document.getElementById('edit-type').value;
  const textOptions = document.getElementById('text-options-panel');
  if (type === 'box') {
    textOptions.style.display = 'block';
  } else {
    textOptions.style.display = 'none';
  }
  // 모듈 데이터에도 즉시 반영
  applyModuleChanges({ target: document.getElementById('edit-type'), type: 'change' });
}


// === [신규] 누락된 모듈 편집 패널 로직 ===

function updateEditPanel() {
  const panel = document.getElementById('edit-panel');
  const textOptions = document.getElementById('text-options-panel');
  const moduleInfo = getSelectedModule();

  if (!moduleInfo) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const { module, layer } = moduleInfo;

  // 1. 패널 필드에 모듈 데이터 로드
  document.getElementById('edit-type').value = module.type || 'box';
  document.getElementById('edit-group-id').value = module.groupId || '';
  document.getElementById('edit-col').value = module.col;
  document.getElementById('edit-row').value = module.row;
  document.getElementById('edit-mobile-col').value = module.mobileCol || '';
  document.getElementById('edit-aspect-ratio').checked = module.aspectRatio === '1/1';
  document.getElementById('edit-color').value = module.color || '#8c6c3c';
  document.getElementById('edit-transparent').checked = module.transparent || false;
  toggleColorPicker('edit', module.transparent || false);
  document.getElementById('edit-border-color').value = module.borderColor || '#000000';
  document.getElementById('edit-border-width').value = module.borderWidth || 0;

  // 2. 텍스트/이미지 옵션 토글
  if (module.type === 'box') {
    textOptions.style.display = 'block';
    // 텍스트 옵션 로드
    document.getElementById('edit-text-align').value = module.textAlign || 'left';
    document.getElementById('edit-vertical-align').value = module.verticalAlign || 'flex-start';
    document.getElementById('edit-font-weight').value = module.fontWeight || '400'; // [신규]
  t document.getElementById('edit-font-color').value = module.fontColor || '#000000';
    document.getElementById('edit-font-size').value = module.fontSize || '';
    document.getElementById('edit-text-content').value = decodeHTML(module.textContent || '');
  } else {
    textOptions.style.display = 'none';
  }
  
  // 3. 잠긴 레이어일 경우 편집 비활성화
  const allInputs = panel.querySelectorAll('input, select, textarea, button');
  allInputs.forEach(input => {
    input.disabled = layer.isLocked;
  });
  // 삭제 버튼은 따로 처리
  const deleteBtn = panel.querySelector('button[onclick*="deleteSelectedModule"]');
  if (deleteBtn) deleteBtn.disabled = layer.isLocked;
}

// === [신규] 편집 패널 변경 사항 적용을 위한 리스너 ===
function setupEditPanelListeners() {
    const panel = document.getElementById('edit-panel');
    if (!panel) return;

    // 'input' 이벤트를 사용할 필드 (텍스트, 숫자)
    const fieldsToWatch = [
        'edit-group-id', 'edit-col', 'edit-row', 'edit-mobile-col', 
        'edit-border-width', 'edit-font-size', 'edit-text-content'
    ];

    fieldsToWatch.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', applyModuleChanges);
        }
    });
    
    // 'change' 이벤트를 사용할 필드 (선택, 체크박스, 색상)
    const changeFields = [
        'edit-type', 'edit-aspect-ratio', 'edit-transparent', 
        'edit-color', 'edit-border-color', 'edit-font-color',
        'edit-text-align', 'edit-vertical-align', 'edit-font-weight'
    ];
    changeFields.forEach(id => {
         const input = document.getElementById(id);
         if (input) {
            input.addEventListener('change', applyModuleChanges);
         }
    });
    
    // 'blur' (포커스 아웃) 시에만 히스토리 저장 (실시간 저장은 너무 많음)
    const blurFields = [
        'edit-group-id', 'edit-col', 'edit-row', 'edit-mobile-col', 
        'edit-border-width', 'edit-font-size', 'edit-text-content'
    ];
    blurFields.forEach(id => {
        const input = document.getElementById(id);
        if(input) input.addEventListener('blur', () => {
            // 값이 변경되었을 때만 저장 (예: 그냥 클릭했다 떼는 경우 제외)
            if (document.activeElement !== input) { // 포커스가 진짜 나갔는지 확인
                saveState();
            }
        });
    });
}

// === [신규] 모듈 변경 사항 적용 함수 ===
function applyModuleChanges(event) {
    const moduleInfo = getSelectedModule();
    if (!moduleInfo) return;

    const { module, layer } = moduleInfo;
    const id = event.target.id;
    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;

    // [중요] 변경 사항을 모듈 객체에 즉시 반영
    switch (id) {
        case 'edit-type': module.type = value; break;
        case 'edit-group-id': module.groupId = value || null; break;
        case 'edit-col': module.col = clamp(parseInt(value) || 1, 1, layer.settings.desktopColumns); break;
        case 'edit-row': module.row = clamp(parseInt(value) || 1, 1, 99); break;
        case 'edit-mobile-col': module.mobileCol = value ? parseInt(value) : null; break;
        case 'edit-aspect-ratio': module.aspectRatio = value ? '1/1' : null; break;
        case 'edit-color': module.color = value; break;
        case 'edit-transparent': module.transparent = value; break;
        case 'edit-border-color': module.borderColor = value; break;
        case 'edit-border-width': module.borderWidth = clamp(parseInt(value) || 0, 0, 20); break;
        // --- 텍스트 ---
        case 'edit-text-align': module.textAlign = value; break;
        case 'edit-vertical-align': module.verticalAlign = value; break;
        case 'edit-font-weight': module.fontWeight = value; break;
        case 'edit-font-color': module.fontColor = value; break;
        case 'edit-font-size': module.fontSize = value ? parseInt(value) : null; break;
        case 'edit-text-content': module.textContent = value; break;
    }
    
    // 캔버스 즉시 렌더링
    renderCanvas();
    updateCode(); // 코드도 업데이트
    
    // 'change' 이벤트(select, checkbox, color)일 때만 히스토리 저장
    if (event.type === 'change') {
        saveState();
    }
}

// === [신규] 누락된 UI 상호작용 함수들 ===

function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(view === 'desktop' ? '데스크톱' : '모바일'));
    });
    renderCanvas();
    updateStats();
}

function handleCanvasClick(event) {
    if (event.target.classList.contains('canvas-viewport') || event.target.classList.contains('grid-container')) {
        deselectModule();
    }
}

function updateStats() {
    const layer = getActiveLayer();
    if (!layer) return;

    document.getElementById('stat-columns').textContent = `${layer.settings.desktopColumns}개`;
    document.getElementById('stat-gap').textContent = `${layer.settings.desktopGap}px`;
    document.getElementById('stat-modules').textContent = `${layer.modules.length}개`;
    
    // 모드 힌트 업데이트
    document.getElementById('mode-hint').textContent = `${layer.settings.desktopColumns}열 → ${layer.settings.targetColumns}열로 리플로우`;
}

function toggleMobileOrderLock(event) {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.settings.mobileOrderLocked = event.target.checked;
    if (layer.settings.mobileOrderLocked) {
        layer.mobileOrder = [...layer.desktopOrder];
        showToast('모바일 순서가 데스크톱 순서와 동기화되었습니다.');
        renderCanvas();
        updateCode();
        saveState();
    } else {
        showToast('모바일 순서 동기화 해제됨');
    }
}

function selectMode(mode) {
    document.querySelectorAll('.mode-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.mode === mode);
    });
}

function copyCode() {
    const code = document.getElementById('code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
        showToast('코드가 클립보드에 복사되었습니다.');
    }, () => {
        showToast('복사 실패');
    });
}

function switchTab(tab, event) {
    activeTab = tab;
    document.querySelectorAll('.code-tab').forEach(t => {
        t.classList.toggle('active', t.textContent.toLowerCase() === tab);
    });
    updateCode();
}

// === [신규] 레이어 설정 UI 연동 ===
function setupSettingsListeners() {
    const inputs = ['columns', 'gap', 'target-columns', 'layer-blend-mode'];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('change', updateSettings);
    });

    document.getElementById('canvas-scale').addEventListener('input', (event) => {
        const scale = event.target.value;
        document.getElementById('scale-readout').textContent = `${scale}%`;
        renderCanvas(); // 스케일은 렌더링만 다시
    });

    document.getElementById('show-selection').addEventListener('change', (event) => {
        showSelection = !event.target.checked;
        renderCanvas();
    });
    
    document.getElementById('dim-inactive-layers').addEventListener('change', (event) => {
        dimInactiveLayers = event.target.checked;
        renderCanvas();
    });
}

function updateSettings(event) {
    const layer = getActiveLayer();
    if (!layer) return;

    const id = event.target.id;
    let value = event.target.value;

    switch (id) {
        case 'columns':
            layer.settings.desktopColumns = clamp(parseInt(value) || 6, 1, 12);
            document.getElementById('edit-col').max = layer.settings.desktopColumns; // 편집패널 최대값 연동
            break;
        case 'gap':
            layer.settings.desktopGap = clamp(parseInt(value) || 10, 0, 50);
            break;
        case 'target-columns':
            layer.settings.targetColumns = clamp(parseInt(value) || 2, 1, 12);
            break;
        case 'layer-blend-mode':
            layer.settings.blendMode = value;
            break;
    }

    renderCanvas();
    updateStats();
    updateCode();
    saveState();
}

function loadSettingsToUI(layer) {
    if (!layer) return;
    document.getElementById('columns').value = layer.settings.desktopColumns;
    document.getElementById('gap').value = layer.settings.desktopGap;
    document.getElementById('target-columns').value = layer.settings.targetColumns;
    document.getElementById('layer-blend-mode').value = layer.settings.blendMode || 'normal';
    document.getElementById('mobile-order-lock').checked = layer.settings.mobileOrderLocked;
}


// === [수정] 코드 생성 (폰트/Box/Text 통합 반영) ===
function generateCode() {
    let html = '';
    let css = '';
    
    const allSortedLayers = getSortedLayers();

    // 1. CSS 생성 (Z-index 및 레이어별 그리드)
    css = `.grid-wrapper {
  position: relative;
  width: 100%;
}\n\n`;

    allSortedLayers.forEach((layer, zIndex) => {
        if (!layer.isVisible) return;
        
        const layerClass = `grid-layer-${layer.id}`;
        
        // 레이어 공통 스타일
        css += `.${layerClass} {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: grid;
  grid-template-columns: repeat(${layer.settings.desktopColumns}, 1fr);
  gap: ${layer.settings.desktopGap}px;
  mix-blend-mode: ${layer.settings.blendMode || 'normal'};
  z-index: ${zIndex + 1};
  isolation: isolate; /* 블렌드 모드 격리 */
}\n\n`;

        // 레이어별 모듈 스타일 (데스크톱)
        layer.desktopOrder.forEach((id, i) => {
            const module = layer.modules.find(m => m.id === id);
            if (!module) return;
            
            const moduleClass = `module-${module.id}`;
            const isTransparent = module.transparent || false;
            const bgColor = isTransparent ? 'transparent' : (module.color || '#8c6c3c');
            const borderWidth = module.borderWidth || 0;
            const borderColor = module.borderColor || '#000000';
            const outlineStyle = borderWidth > 0 ? `outline: ${borderWidth}px solid ${borderColor}; outline-offset: -${borderWidth}px;` : '';

            css += `.${layerClass} .${moduleClass} {
  grid-column: span ${module.col};
  grid-row: span ${module.row};
  background: ${module.type === 'image' ? '#e0e0e0' : bgColor};
  ${outlineStyle}
  ${module.aspectRatio ? `aspect-ratio: ${module.aspectRatio};` : ''}
`;
            // Box 타입일 때 텍스트 스타일 추가
            if (module.type === 'box') {
                css += `  display: flex;
  align-items: ${module.verticalAlign || 'flex-start'};
  padding: 10px;
  text-align: ${module.textAlign || 'left'};
  color: ${module.fontColor || '#000000'};
  font-size: ${module.fontSize ? module.fontSize + 'px' : '14px'};
  font-weight: ${module.fontWeight || '400'};
`;
            }
            if (module.type === 'image') {
              css += `  overflow: hidden; /* 이미지 모듈용 */\n`
            }
            css += `}\n`;
            
            // 이미지 타입용 img 태그 스타일
            if (module.type === 'image') {
              css += `.${layerClass} .${moduleClass} img {
  width: 100%; height: 100%; object-fit: cover;
}\n`;
            }
        });
        
        css += `\n`;
    });

    // 2. 미디어 쿼리 (모바일)
    css += `@media (max-width: 768px) {\n`;
    allSortedLayers.forEach(layer => {
        if (!layer.isVisible) return;
        
        const layerClass = `grid-layer-${layer.id}`;
        css += `  .${layerClass} {
    grid-template-columns: repeat(${layer.settings.targetColumns}, 1fr);
    gap: ${layer.settings.mobileGap || 10}px;
  }\n\n`;

        // 모바일 순서 및 스팬 적용
        layer.mobileOrder.forEach((id, i) => {
            const module = layer.modules.find(m => m.id === id);
            if (!module) return;
            
            const moduleClass = `module-${module.id}`;
            const mobileColSpan = getMobileSpan(module, layer);
            
            css += `  .${layerClass} .${moduleClass} {
    grid-column: span ${mobileColSpan};
    order: ${i + 1};
  }\n`;
        });
        css += `\n`;
    });
    css += `}\n`;

    // 3. HTML 생성
    html = `<div class="grid-wrapper">\n`;
    allSortedLayers.forEach(layer => {
        if (!layer.isVisible) return;

        html += `  <div class="grid-layer-${layer.id}">\n`;
        // 모바일 순서 기준으로 HTML을 생성 (CSS order로 재정렬)
        layer.mobileOrder.forEach(id => {
            const module = layer.modules.find(m => m.id === id);
            if (!module) return;
            
            html += `    <div class="module-${module.id}">`;
            if (module.type === 'box' && module.textContent) {
                // escapeHTML: HTML 태그가 아닌 줄바꿈(<br>)만 적용
                html += `\n      ${escapeHTML(module.textContent).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}\n    `;
            } else if (module.type === 'image') {
                html += `<img src="https." alt="image">`;
            }
            html += `</div>\n`;
        });
        html += `  </div>\n`;
    });
    html += `</div>`;

    return { html, css };
}

function updateCode() {
    const { html, css } = generateCode();
    const display = document.getElementById('code-display');
    
    if (activeTab === 'html') {
        display.textContent = html;
    } else {
        display.textContent = css;
    }
    // (Syntax highlighting은 추후 추가)
}


// === [신규] 초기화 로직 ===
document.addEventListener('DOMContentLoaded', () => {
  // 첫 레이어 추가
  addLayer();
  // 첫 상태 저장 (Undo용)
  saveState(); 
  historyIndex = 0; // 첫 상태는 undo 못하게
  updateUndoRedoButtons();

  // 편집 패널 리스너 설정
  setupEditPanelListeners();
  
  // 설정 패널 리스너 설정
  setupSettingsListeners();
  
  // 초기 탭 설정
  switchTab('html', { target: document.querySelector('.code-tab.active') });
  
  // 초기 뷰 버튼 활성화
  switchView('desktop');
  
  // '추가' 패널 옵션 초기화
  toggleCustomOptions();
});