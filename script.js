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
let draggedLayerId = null; 

// --- [신규] 히스토리 변수 (레이어 구조 전체 저장) ---
let history = [];
let historyIndex = -1;

// --- [신규] 헬퍼: 깊은 복사 ---
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
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
      activeLayerId = layers[layers.length - 1].id;
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

// === [수정] 레이어 패널 렌더링 (드래그 핸들 추가) ===
function renderLayersList() {
  const list = document.getElementById('layer-list');
  if (!list) return;
  list.innerHTML = layers.map(layer => `
    <li class="layer-item ${layer.id === activeLayerId ? 'active' : ''} ${layer.isLocked ? 'locked' : ''}" 
        onclick="activateLayer(${layer.id})"
        data-layer-id="${layer.id}"
        ondragover="handleLayerDragOver(event)"
        ondrop="handleLayerDrop(event, ${layer.id})"
        ontouchend="handleLayerTouchEnd(event)">
      
      <div class="layer-drag-handle"
           draggable="true"
           ondragstart="handleLayerDragStart(event, ${layer.id})"
           ondragend="handleLayerDragEnd(event)"
           ontouchstart="handleLayerTouchStart(event, ${layer.id})"
           ontouchmove="handleLayerTouchMove(event)">⠿</div>
      
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


// === [수정] 캔버스 렌더링 (블렌딩 격리 추가) ===
function renderCanvas() {
  const viewport = document.getElementById('canvas-viewport');
  if (!viewport) return;
  
  const scaleValue = parseInt(document.getElementById('canvas-scale').value);
  viewport.style.transform = `scale(${scaleValue / 100})`;
  viewport.classList.toggle('mobile-view', currentView === 'mobile');
  viewport.classList.toggle('selection-hidden', !showSelection);
  
  const selectedModuleInfo = getSelectedModule();
  const selectedGroupId = (selectedModuleInfo && selectedModuleInfo.module.groupId) ? selectedModuleInfo.module.groupId : null;

  viewport.innerHTML = layers.map(layer => {
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
      if (moduleType === 'text') { innerHTML = `<p class="module-content">Lorem ipsum...</p>`; } 
      else if (moduleType === 'image') { innerHTML = `<img src="https://via.placeholder.com/${desktopColSpan * 100}x${moduleData.row * 50}" alt="placeholder" class="module-content image">`; }
      
      const selectedClass = (showSelection && isSelected) ? 'selected' : '';
      const groupedClass = (showSelection && selectedGroupId && moduleData.groupId === selectedGroupId && !isSelected) ? 'grouped' : '';
      const aspectStyle = moduleData.aspectRatio ? `aspect-ratio: ${moduleData.aspectRatio};` : '';

      return `
      <div class="module ${selectedClass} ${groupedClass} ${showWarning ? 'warning' : ''}" 
           style="grid-column: span ${col}; grid-row: span ${moduleData.row}; background: ${moduleType === 'box' ? bgColor : ''}; ${outlineStyle} ${aspectStyle}"
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
             ontouchstart="handleModuleTouchStart(event, ${layer.id}, ${moduleData.id}, ${i})"
             ontouchmove="handleModuleTouchMove(event)"
             ontouchend="handleModuleTouchEnd(event)">⠿</div>
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

// === [수정] 레이어 드래그 앤 드롭 핸들러 (마우스) ===
function handleLayerDragStart(event, layerId) {
    event.stopPropagation();
    draggedLayerId = layerId;
    // [수정] event.target (핸들)의 부모 .layer-item에 dragging 클래스 추가
    const layerItem = event.target.closest('.layer-item');
    if (layerItem) layerItem.classList.add('dragging');
    
    if(event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
}

function handleLayerDragOver(event) {
    event.preventDefault();
    if(event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
}

function handleLayerDrop(event, targetLayerId) {
    event.stopPropagation();
    const targetElement = event.target.closest('.layer-item');
    if(targetElement) targetElement.classList.remove('dragging');
    
    if (draggedLayerId === null || draggedLayerId === targetLayerId) {
        draggedLayerId = null;
        document.querySelectorAll('.layer-item.dragging').forEach(el => el.classList.remove('dragging'));
        return;
    }

    const draggedIndex = layers.findIndex(l => l.id === draggedLayerId);
    const targetIndex = layers.findIndex(l => l.id === targetLayerId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [draggedLayer] = layers.splice(draggedIndex, 1);
    layers.splice(targetIndex, 0, draggedLayer);

    draggedLayerId = null;
    
    renderLayersList(); 
    renderCanvas();     
    updateCode();
    saveState();
}

function handleLayerDragEnd(event) {
    // [수정] event.target (핸들)의 부모 .layer-item에서 dragging 클래스 제거
    const layerItem = event.target.closest('.layer-item');
    if (layerItem) layerItem.classList.remove('dragging');
    draggedLayerId = null;
}

// === [수정] 레이어 터치 드래그 핸들러 (모바일) ===
function handleLayerTouchStart(event, layerId) {
    event.stopPropagation();
    draggedLayerId = layerId;
    // [수정] event.target (핸들)의 부모 .layer-item에 dragging 클래스 추가
    event.target.closest('.layer-item').classList.add('dragging');
}

function handleLayerTouchMove(event) {
    if (!draggedLayerId) return;
    event.preventDefault(); // [중요] 스크롤 및 텍스트 선택(긁힘) 방지
}

function handleLayerTouchEnd(event) {
    if (!draggedLayerId) return;
    event.stopPropagation();

    // 터치가 끝난 지점의 요소를 찾음
    const touch = event.changedTouches[0];
    const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetLi = targetElement ? targetElement.closest('.layer-item[data-layer-id]') : null;

    if (targetLi) {
        const targetLayerId = parseInt(targetLi.dataset.layerId);
        handleLayerDrop(event, targetLayerId); // 드롭 로직 재사용
    } else {
        // 드롭에 실패하면 드래그 취소
        document.querySelectorAll('.layer-item.dragging').forEach(el => el.classList.remove('dragging'));
        draggedLayerId = null;
    }
}

// === [신규] 레이어 관리 함수 ===
function addLayer() {
  const newName = `Layer ${layers.length + 1}`;
  const newLayer = {
    id: Date.now(),
    name: newName,
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
    activeLayerId = layers[layers.length - 1].id;
    selectedModuleId = null;

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


// === [수정] 모듈 관리 함수 (활성 레이어 기반) ===

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
    aspectRatio: null
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
        ...deepCopy(module), 
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

// === [수정] 모듈 드래그 앤 드롭 (마우스) ===

function handleDragStart(layerId, moduleId, moduleIndexInOrder, event) {
  const layer = layers.find(l => l.id === layerId);
  if (!layer || layer.isLocked) { event.preventDefault(); return; }
  
  draggedModuleInfo = { layerId, moduleId, moduleIndexInOrder };
  event.target.closest('.module').classList.add('dragging');
  if(event.dataTransfer) {
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

// === [신규] 모듈 터치 드래그 핸들러 (모바일) ===
function handleModuleTouchStart(event, layerId, moduleId, index) {
    event.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (!layer || layer.isLocked) { return; }
    
    draggedModuleInfo = { layerId, moduleId, moduleIndexInOrder: index };
    event.target.closest('.module').classList.add('dragging');
}

function handleModuleTouchMove(event) {
    if (!draggedModuleInfo) return;
    event.preventDefault(); 
}

function handleModuleTouchEnd(event) {
    if (!draggedModuleInfo) return;
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

    handleDragEnd(event);
}

// === [수정] 코드 생성 (블렌딩 격리 추가) ===

function generateHTML() {
  let html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="grid-viewport-wrapper">
`;

  layers.filter(l => l.isVisible).forEach(layer => {
    html += `
    <div class="grid-container" id="grid-layer-${layer.id}">
  ${layer.desktopOrder.map(id => {
      const m = layer.modules.find(mod => mod.id === id);
      if (!m) return '';
      const groupClass = m.groupId ? ` group-${m.groupId}` : '';
      return `    <div class="module module-${m.id} type-${m.type || 'box'}${groupClass}">
  ${m.type === 'text' ? '      <p>Lorem ipsum...</p>' : (m.type === 'image' ? '      <img src="https://via.placeholder.com/150" alt="placeholder">' : '      ')}
    </div>`;
    }).join('\n')}
    </div>
  `;
  });

  html += `
  </div>
</body>
</html>`;
  return html;
}

function generateCSS() {
  let css = `body {
  margin: 0;
  background: whitesmoke;
  padding: ${layers.length > 0 ? layers[0].settings.desktopGap : 10}px;
}
.grid-viewport-wrapper {
  position: relative;
  max-width: 1400px; /* 예시 최대 너비 */
  margin: 0 auto;
}
.grid-container {
  display: grid;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none; 
}
.grid-container .module {
  pointer-events: auto; /* 모듈은 클릭 가능하게 */
}

.module {
  min-height: 60px;
}
.module.type-image { background: #e0e0e0; }
.module.type-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.module.type-text { background: #ffffff; padding: 10px; }
`;

  layers.filter(l => l.isVisible).forEach(layer => {
    const { settings } = layer;
    css += `
/* --- Layer: ${layer.name} (Desktop) --- */
#grid-layer-${layer.id} {
  grid-template-columns: repeat(${settings.desktopColumns}, 1fr);
  gap: ${settings.desktopGap}px;
  mix-blend-mode: ${settings.blendMode || 'normal'};
  isolation: isolate; /* [신규] 블렌딩 격리 */
}
`;
    layer.modules.forEach(m => {
      const col = clamp(m.col, 1, settings.desktopColumns);
      const bg = m.transparent ? 'transparent' : (m.color || '#8c6c3c');
      const outline = m.borderWidth > 0 ? `\n  outline: ${m.borderWidth}px solid ${m.borderColor};\n  outline-offset: -${m.borderWidth}px;` : '';
      const bgStyle = (m.type === 'box' || !m.type) ? `background: ${bg};` : '';
      const aspect = m.aspectRatio ? `\n  aspect-ratio: ${m.aspectRatio};` : '';

      css += `.module-${m.id} {
  grid-column: span ${col};
  grid-row: span ${m.row};
  ${bgStyle}${outline}${aspect}
}\n`;
    });
  });

  css += `
/* --- Mobile --- */
@media (max-width: 768px) {
  .grid-container {
    position: relative;
    width: 100%;
  }
`;

  layers.filter(l => l.isVisible).forEach(layer => {
    const { settings } = layer;
    css += `
  /* --- Layer: ${layer.name} (Mobile) --- */
  #grid-layer-${layer.id} {
    grid-template-columns: repeat(${settings.targetColumns}, 1fr);
    gap: ${settings.mobileGap}px;
  }
`;
    layer.mobileOrder.forEach((id, i) => {
      const m = layer.modules.find(mod => mod.id === id);
      if (!m) return '';
      const mobileSpan = getMobileSpan(m, layer);
      const comment = m.mobileCol !== null ? '/*수동*/' : `/*자동:min(${m.col},${settings.targetColumns})*/`;
      
      css += `  .module-${m.id} {
    grid-column: span ${mobileSpan}; ${comment}
    grid-row: span ${m.row};
    order: ${i};
  }\n`;
    });
  });

  css += '\n}\n';
  return css;
}


// === [신규] UI 컨트롤 및 이벤트 핸들러 ===

function init() {
  function addSettingsListener(elementId, eventType, settingKey, valueFn, doSaveState = false, doRender = true) {
    document.getElementById(elementId).addEventListener(eventType, e => {
      const layer = getActiveLayer();
      if (layer) {
        layer.settings[settingKey] = valueFn(e);
        if (doRender) renderCanvas();
        
        updateStats();
        updateModeHint();
        updateMobileSpanHint();
        updateCode();

        if (doSaveState) saveState();
      }
    });
  }
  
  addSettingsListener('layer-blend-mode', 'change', 'blendMode', e => e.target.value, true);
  addSettingsListener('columns', 'input', 'desktopColumns', e => clamp(parseInt(e.target.value) || 1, 1, 12));
  addSettingsListener('columns', 'change', 'desktopColumns', e => clamp(parseInt(e.target.value) || 1, 1, 12), true);
  addSettingsListener('gap', 'input', 'desktopGap', e => clamp(parseInt(e.target.value) || 0, 0, 50));
  addSettingsListener('gap', 'change', 'desktopGap', e => clamp(parseInt(e.target.value) || 0, 0, 50), true);
  addSettingsListener('target-columns', 'input', 'targetColumns', e => clamp(parseInt(e.target.value) || 1, 1, 12));
  addSettingsListener('target-columns', 'change', 'targetColumns', e => clamp(parseInt(e.target.value) || 1, 1, 12), true);
  addSettingsListener('mobile-order-lock', 'change', 'mobileOrderLocked', e => e.target.checked, true, false); 
  
  document.getElementById('canvas-scale').addEventListener('input', renderCanvas);
  
  document.getElementById('show-selection').addEventListener('change', e => {
    showSelection = e.target.checked;
    renderCanvas(); 
  });
  
  document.getElementById('dim-inactive-layers').addEventListener('change', e => {
      dimInactiveLayers = e.target.checked;
      renderCanvas();
  });
  
  function addEditListener(elementId, eventType, property, valueFn, doSaveState = false) {
    document.getElementById(elementId).addEventListener(eventType, e => {
      const moduleInfo = getSelectedModule();
      if (moduleInfo) {
        moduleInfo.module[property] = valueFn(e, moduleInfo.layer); 
        renderCanvas();
        if(property === 'col' || property === 'mobileCol') updateMobileSpanHint();
        if (doSaveState) saveState();
      }
    });
  }
  
  addEditListener('edit-type', 'change', 'type', e => e.target.value, true);
  addEditListener('edit-group-id', 'change', 'groupId', e => e.target.value.trim() || null, true);
  addEditListener('edit-col', 'input', 'col', (e, layer) => clamp(parseInt(e.target.value) || 1, 1, layer.settings.desktopColumns));
  addEditListener('edit-col', 'change', 'col', (e, layer) => clamp(parseInt(e.target.value) || 1, 1, layer.settings.desktopColumns), true);
  addEditListener('edit-row', 'input', 'row', e => clamp(parseInt(e.target.value) || 1, 1, 99));
  addEditListener('edit-row', 'change', 'row', e => clamp(parseInt(e.target.value) || 1, 1, 99), true);
  addEditListener('edit-mobile-col', 'input', 'mobileCol', (e, layer) => e.target.value === '' ? null : clamp(parseInt(e.target.value) || 1, 1, layer.settings.targetColumns));
  addEditListener('edit-mobile-col', 'change', 'mobileCol', (e, layer) => e.target.value === '' ? null : clamp(parseInt(e.target.value) || 1, 1, layer.settings.targetColumns), true);
  addEditListener('edit-aspect-ratio', 'change', 'aspectRatio', e => e.target.checked ? '1 / 1' : null, true);
  addEditListener('edit-color', 'input', 'color', e => e.target.value);
  addEditListener('edit-color', 'change', 'color', e => e.target.value, true);
  addEditListener('edit-border-color', 'input', 'borderColor', e => e.target.value);
  addEditListener('edit-border-color', 'change', 'borderColor', e => e.target.value, true);
  addEditListener('edit-border-width', 'input', 'borderWidth', e => clamp(parseInt(e.target.value) || 0, 0, 20));
  addEditListener('edit-border-width', 'change', 'borderWidth', e => clamp(parseInt(e.target.value) || 0, 0, 20), true);
  
  addLayer(); 
}

function loadSettingsToUI(layer) {
  if (!layer) {
      document.getElementById('columns').value = 6;
      document.getElementById('gap').value = 10;
      document.getElementById('target-columns').value = 2;
      document.getElementById('mobile-order-lock').checked = false;
      document.getElementById('layer-blend-mode').value = 'normal'; 
      return;
  }
  const { settings } = layer;
  document.getElementById('columns').value = settings.desktopColumns;
  document.getElementById('gap').value = settings.desktopGap;
  document.getElementById('target-columns').value = settings.targetColumns;
  document.getElementById('mobile-order-lock').checked = settings.mobileOrderLocked;
  document.getElementById('layer-blend-mode').value = settings.blendMode || 'normal'; 
  
  updateModeHint();
  updateMobileSpanHint();
}

function updateEditPanel() {
  const panel = document.getElementById('edit-panel');
  const moduleInfo = getSelectedModule();
  
  if (!moduleInfo) {
    panel.style.display = 'none';
    return;
  }
  
  const { module, layer } = moduleInfo;
  panel.style.display = 'block';
  
  document.getElementById('edit-type').value = module.type || 'box';
  document.getElementById('edit-group-id').value = module.groupId || '';
  document.getElementById('edit-col').value = clamp(module.col, 1, layer.settings.desktopColumns);
  document.getElementById('edit-col').max = layer.settings.desktopColumns;
  document.getElementById('edit-row').value = module.row;
  document.getElementById('edit-mobile-col').value = module.mobileCol !== null ? clamp(module.mobileCol, 1, layer.settings.targetColumns) : '';
  document.getElementById('edit-mobile-col').max = layer.settings.targetColumns;
  document.getElementById('edit-aspect-ratio').checked = (module.aspectRatio === '1 / 1');
  document.getElementById('edit-color').value = module.color || '#8c6c3c';
  const isTransparent = module.transparent || false;
  document.getElementById('edit-transparent').checked = isTransparent;
  toggleColorPicker('edit', isTransparent);
  document.getElementById('edit-border-color').value = module.borderColor || '#000000';
  document.getElementById('edit-border-width').value = module.borderWidth || 0;
  document.getElementById('split-h').value = 1;
  document.getElementById('split-v').value = 1;

  updateMobileSpanHint();
}

function handleCanvasClick(event) {
  if (event.target.id === 'canvas-viewport' || event.target.classList.contains('grid-container')) {
    deselectModule();
  }
}

function calculateMobileSpan(desktopCol, desktopCols, targetCols) {
  return Math.max(1, Math.min(desktopCol, targetCols));
}
function getMobileSpan(module, layer) {
  const { settings } = layer;
  if(module.mobileCol !== undefined && module.mobileCol !== null && module.mobileCol !== '') {
    const clampedTarget = Math.min(module.mobileCol, settings.targetColumns);
    return Math.max(1, clampedTarget);
  }
  return calculateMobileSpan(module.col, settings.desktopColumns, settings.targetColumns);
}

function updateStats() {
  const layer = getActiveLayer();
  if (!layer) {
      document.getElementById('stat-columns').textContent = `N/A`;
      document.getElementById('stat-gap').textContent = `N/A`;
      document.getElementById('stat-modules').textContent = `0개`;
      return;
  }
  document.getElementById('stat-columns').textContent = `${layer.settings.desktopColumns}개`;
  document.getElementById('stat-gap').textContent = `${layer.settings.desktopGap}px`;
  document.getElementById('stat-modules').textContent = `${layer.modules.length}개`;
}
function updateModeHint() {
  const layer = getActiveLayer();
  if (!layer) return;
  document.getElementById('mode-hint').textContent = `${layer.settings.desktopColumns}열 → ${layer.settings.targetColumns}열로 리플로우`;
}
function updateMobileSpanHint() {
  const moduleInfo = getSelectedModule();
  if(!moduleInfo) return;
  const { module, layer } = moduleInfo;
  const auto = getMobileSpan(module, layer); 
  document.getElementById('mobile-span-hint').textContent = `자동: ${auto}열 (min(${module.col}열, ${layer.settings.targetColumns}열))`;
}
function updateAddModuleHint() {
    const layer = getActiveLayer();
    const hintEl = document.getElementById('add-module-hint');
    const btnEl = document.getElementById('add-module-btn');
    if (!layer) {
        hintEl.textContent = '활성 레이어가 없습니다.';
        btnEl.disabled = true;
    } else if (layer.isLocked) {
        hintEl.textContent = `🔒 '${layer.name}' 레이어가 잠겨있습니다.`;
        btnEl.disabled = true;
    } else {
        hintEl.textContent = `활성 레이어: '${layer.name}'`;
        btnEl.disabled = false;
    }
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.view-btn[onclick="switchView('${view}')"]`).classList.add('active');
  deselectModule();
  renderCanvas();
}

function toggleMobileOrderLock(event) {
  const layer = getActiveLayer();
  if (!layer) return;
  
  layer.settings.mobileOrderLocked = event.target.checked;
  if (layer.settings.mobileOrderLocked) {
    layer.mobileOrder = [...layer.desktopOrder];
    showToast('모바일 순서가 데스크톱에 동기화됩니다.');
    renderCanvas();
    saveState();
  } else {
    showToast('모바일 순서 동기화 해제');
    saveState(); 
  }
}

function toggleColorPicker(prefix, isTransparent) {
  const colorInput = document.getElementById(prefix + '-color');
  colorInput.disabled = isTransparent;
  colorInput.style.opacity = isTransparent ? 0.5 : 1;
  if (prefix === 'edit') {
      const moduleInfo = getSelectedModule();
      if (moduleInfo && moduleInfo.module.transparent !== isTransparent) {
          moduleInfo.module.transparent = isTransparent;
          renderCanvas();
          saveState();
      }
  }
}
function selectMode(mode) {
  if (mode !== 'reflow') { showToast('이 모드는 현재 지원되지 않습니다.'); return; }
  document.querySelectorAll('.mode-option').forEach(opt => opt.classList.remove('selected'));
  document.querySelector(`[data-mode="${mode}"]`).classList.add('selected');
  updateModeHint();
  updateCode();
  showToast(getModeLabel(mode) + ' 모드');
}
function getModeLabel(mode) { return {'reflow':'리플로우'}[mode]; }
function updateCode() {
  document.getElementById('code-display').textContent = activeTab === 'html' ? generateHTML() : generateCSS();
}
function switchTab(tab, event) {
  activeTab = tab;
  document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  updateCode();
}
function copyCode() {
  navigator.clipboard.writeText(activeTab === 'html' ? generateHTML() : generateCSS());
  showToast(`${activeTab.toUpperCase()} 코드 복사됨!`);
}
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
}

// --- DOM 로드 후 초기화 ---
window.addEventListener('DOMContentLoaded', init);