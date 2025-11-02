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
// [삭제] draggedLayerId = null; 

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
      // [수정] 정렬된 레이어 기준 (이론상 마지막 레이어)
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
  
  // [수정] 정렬된 레이어 순서대로 목록을 그림
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


// === [수정] 캔버스 렌더링 (텍스트/순서 적용) ===
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
      const moduleType = moduleData.type || 'box';

      let textStyles = '';
      let moduleFlexStyles = '';
            
      if (moduleType === 'text') { 
        textStyles = `
          text-align: ${moduleData.textAlign || 'left'};
          color: ${moduleData.fontColor || '#000000'};
          font-size: ${moduleData.fontSize ? moduleData.fontSize + 'px' : '14px'};
          width: 100%; 
          margin: 0; 
        `;
        moduleFlexStyles = `
          display: flex;
          align-items: ${moduleData.verticalAlign || 'flex-start'};
          padding: 10px; 
        `;
        // [수정] 텍스트 내용을 escapeHTML로 안전하게 렌더링
        innerHTML = `<p class="module-content" style="${textStyles}">${escapeHTML(moduleData.textContent)}</p>`; 
      } 
      else if (moduleType === 'image') { 
        innerHTML = `<img src="https://via.placeholder.com/${desktopColSpan * 100}x${moduleData.row * 50}" alt="placeholder" class="module-content image">`; 
      }
      
      const selectedClass = (showSelection && isSelected) ? 'selected' : '';
      const groupedClass = (showSelection && selectedGroupId && moduleData.groupId === selectedGroupId && !isSelected) ? 'grouped' : '';
      const aspectStyle = moduleData.aspectRatio ? `aspect-ratio: ${moduleData.aspectRatio};` : '';

      return `
      <div class="module ${selectedClass} ${groupedClass} ${showWarning ? 'warning' : ''}" 
           style="grid-column: span ${col}; grid-row: span ${moduleData.row}; background: ${moduleType === 'box' ? bgColor : ''}; ${outlineStyle} ${aspectStyle} ${moduleFlexStyles}"
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

// === [삭제] 레이어 드래그 앤 드롭 핸들러 (모두 삭제) ===
// handleLayerDragStart, handleLayerDragOver, handleLayerDrop, handleLayerDragEnd
// handleLayerTouchStart

// === [신규] 레이어 우선순위 관리 함수 ===
function updateLayerPriority(event, layerId) {
  event.stopPropagation();
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  
  // 입력된 값을 우선순위로 설정
  layer.priority = parseFloat(event.target.value) || 0;
  
  // 모든 레이어의 우선순위를 정규화 (0, 1, 2, 3...)
  normalizeLayerPriorities();
  
  saveState();
  renderLayersList(); // 새 순서(와 새 번호)로 목록 다시 그림
  renderCanvas();     // 새 Z-index 순서로 캔버스 다시 그림
  updateCode();
}

function normalizeLayerPriorities() {
  // 현재 설정된 우선순위 값 기준으로 정렬
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);
  
  // 0부터 순서대로 번호(priority)를 다시 매김
  sorted.forEach((layer, index) => {
    // 원본 layers 배열에서 해당 객체를 찾아 priority 값을 업데이트
    const originalLayer = layers.find(l => l.id === layer.id);
    if (originalLayer) {
      originalLayer.priority = index;
    }
  });
}


// === [신규] 레이어 관리 함수 ===
function addLayer() {
  const newName = `Layer ${layers.length + 1}`;
  
  // [신규] 새 레이어는 가장 높은 우선순위 값(가장 위에 보임)을 가짐
  const newPriority = layers.length > 0 ? Math.max(...layers.map(l => l.priority)) + 1 : 0;

  const newLayer = {
    id: Date.now(),
    name: newName,
    priority: newPriority, // [수정] priority 속성 추가
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
    // [수정] 정렬된 리스트에서 마지막 레이어를 활성화
    activeLayerId = getSortedLayers()[getSortedLayers().length - 1].id;
    selectedModuleId = null;

    // [신규] 레이어 삭제 후 우선순위 정규화
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


// === [수정] 모듈 관리 함수 (텍스트 속성 추가) ===

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
  
  const newModule = { 
    col, row, color, transparent, borderColor, borderWidth, 
    mobileCol: null, id: Date.now(),
    type: type, 
    groupId: null,
    aspectRatio: null,
    // [신규] 텍스트 속성 기본값
    textContent: 'Lorem ipsum...', // [수정]
    textAlign: 'left',
    verticalAlign: 'flex-start',
    fontColor: '#000000',
    fontSize: null 
  };
  
  layer.modules.push(newModule);
  layer.desktopOrder.push(newModule.id);
  if (layer.settings.mobileOrderLocked) {
    layer.mobileOrder = [...layer.desktopOrder];
  } else {
    layer.mobileOrder.push(newModule.id);
  }
  
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

  const baseCol = Math.floor(module.col / h);
  const remainderCol = module.col % h;
  const baseRow = Math.floor(module.row / v);
  const remainderRow = module.row % v;

  const newGroupId = 'split-' + Date.now();
  let newModules = [];
  let newModuleIds = [];

  for (let r = 0; r < v; r++) { 
    const newRow = baseRow + (r < remainderRow ? 1 : 0);
    for (let c = 0; c < h; c++) { 
      const newCol = baseCol + (c < remainderCol ? 1 : 0);
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
  event.target.closest('.module').classList.add('dragging');
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
          saveState();
      }
      draggedModuleInfo = null;
      return;
  }
  
  const targetId = order[targetModuleIndexInOrder];
  if (idsToMove.includes(targetId)) {
      draggedModuleInfo = null;
      return; 
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
            
            handleDrop(event, targetLayerId, targetModuleIndex); 
            dropped = true;
        } else if (targetGrid) {
            const targetLayerId = parseInt(targetGrid.id.split('-')[1]);
            handleDrop(event, targetLayerId, null); 
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

// === [수정] 코드 생성 (폰트 적용 및 텍스트