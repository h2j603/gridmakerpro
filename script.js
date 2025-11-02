// --- [신규] 글로벌 상태 변수 ---
let layers = []; // { id, name, modules, desktopOrder, mobileOrder, isVisible, isLocked }
let activeLayerId = null;
let selectedModuleId = null;

// --- [신규] 글로벌 설정 변수 (모든 레이어 공통) ---
let desktopColumns = 6, desktopGap = 10;
let targetColumns = 2, mobileGap = 10;
let responsiveMode = 'reflow';
let currentView = 'desktop', activeTab = 'html';
let mobileOrderLocked = false;
let showSelection = true;

// --- [신규] 드래그 상태 변수 ---
let draggedModuleInfo = null; // { layerId, moduleId, moduleIndexInOrder }

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
    // 모듈을 못찾으면 선택 해제
    selectedModuleId = null;
    return null;
  }
  return module;
}

// --- [신규] 헬퍼: ID로 모듈 찾기 (모든 레이어) ---
function findModuleById(moduleId) {
    for (const layer of layers) {
        const module = layer.modules.find(m => m.id === moduleId);
        if (module) {
            return { module, layer };
        }
    }
    return null;
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

  // 활성 레이어가 삭제된 경우 대비
  if (!getActiveLayer() && layers.length > 0) {
      activeLayerId = layers[layers.length - 1].id;
  }
  
  renderAll(); // 모든 UI 다시 그리기
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

// === [신규] 레이어 패널 렌더링 ===
function renderLayersList() {
  const list = document.getElementById('layer-list');
  if (!list) return;
  list.innerHTML = layers.map((layer, index) => `
    <li class="layer-item ${layer.id === activeLayerId ? 'active' : ''} ${layer.isLocked ? 'locked' : ''}" 
        onclick="activateLayer(${layer.id})">
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

// === [신규] 캔버스 (모든 레이어) 렌더링 ===
function renderCanvas() {
  const viewport = document.getElementById('canvas-viewport');
  if (!viewport) return;
  
  // 캔버스 배율/뷰 설정
  const scaleValue = parseInt(document.getElementById('canvas-scale').value);
  viewport.style.transform = `scale(${scaleValue / 100})`;
  viewport.classList.toggle('mobile-view', currentView === 'mobile');
  
  const columns = currentView === 'desktop' ? desktopColumns : targetColumns;
  const gap = currentView === 'desktop' ? desktopGap : mobileGap;
  
  // [신규] 그룹 시각화를 위해 현재 선택된 모듈의 그룹 ID 가져오기
  const selectedModule = getSelectedModule();
  const selectedGroupId = (selectedModule && selectedModule.groupId) ? selectedModule.groupId : null;

  viewport.innerHTML = layers.map(layer => {
    if (!layer.isVisible) return `<div class="grid-container hidden" id="grid-${layer.id}"></div>`;
    
    const isActive = layer.id === activeLayerId;
    const isLocked = layer.isLocked;
    
    // 순서가 적용된 모듈 목록 가져오기
    const order = currentView === 'desktop' ? layer.desktopOrder : layer.mobileOrder;
    const orderedModules = order.map(id => layer.modules.find(m => m.id === id)).filter(m => m);

    const modulesHTML = orderedModules.map((moduleData, i) => {
      const isSelected = isActive && moduleData.id === selectedModuleId;
      
      const isTransparent = moduleData.transparent || false;
      const bgColor = isTransparent ? 'transparent' : (moduleData.color || '#8c6c3c');
      const borderWidth = moduleData.borderWidth || 0;
      const borderColor = moduleData.borderColor || '#000000';
      const outlineStyle = borderWidth > 0 ? `outline: ${borderWidth}px solid ${borderColor}; outline-offset: -${borderWidth}px;` : '';
      
      const desktopColSpan = clamp(moduleData.col, 1, desktopColumns);
      const mobileColSpan = getMobileSpan(moduleData);
      const col = currentView === 'desktop' ? desktopColSpan : mobileColSpan;
      
      const showWarning = currentView === 'mobile' && 
                          moduleData.col > targetColumns && 
                          (moduleData.mobileCol === null || moduleData.mobileCol === undefined || moduleData.mobileCol === '');
      
      let innerHTML = '';
      const moduleType = moduleData.type || 'box';
      if (moduleType === 'text') {
          innerHTML = `<p class="module-content">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus.</p>`;
      } else if (moduleType === 'image') {
          innerHTML = `<img src="https://via.placeholder.com/${desktopColSpan * 100}x${moduleData.row * 50}" alt="placeholder" class="module-content image">`;
      }
      
      const selectedClass = (showSelection && isSelected) ? 'selected' : '';
      const groupedClass = (showSelection && selectedGroupId && moduleData.groupId === selectedGroupId && !isSelected) ? 'grouped' : '';
      const aspectStyle = moduleData.aspectRatio ? `aspect-ratio: ${moduleData.aspectRatio};` : '';

      return `
      <div class="module ${selectedClass} ${groupedClass} ${showWarning ? 'warning' : ''}" 
           style="grid-column: span ${col}; grid-row: span ${moduleData.row}; background: ${moduleType === 'box' ? bgColor : ''}; ${outlineStyle} ${aspectStyle}"
           data-type="${moduleType}"
           data-group-id="${moduleData.groupId || ''}"
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
             ondragend="handleDragEnd(event)">⠿</div>
      </div>
    `}).join('');
    
    return `
      <div class="grid-container ${isActive ? 'active-layer' : ''} ${isLocked ? 'locked' : ''} ${!layer.isVisible ? 'hidden' : ''}"
           id="grid-${layer.id}"
           style="grid-template-columns: repeat(${columns}, 1fr); gap: ${gap}px;"
           ondragover="${isActive && !isLocked ? 'handleDragOver(event)' : ''}"
           ondrop="${isActive && !isLocked ? 'handleDrop(${layer.id}, null, event)' : ''}">
        ${modulesHTML}
      </div>
    `;
  }).join('');
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
    isLocked: false
  };
  layers.push(newLayer);
  activateLayer(newLayer.id); // 새 레이어를 활성화
  saveState();
  showToast(`${newName} 추가됨`);
}

function deleteActiveLayer() {
  if (layers.length <= 1) {
    showToast('마지막 레이어는 삭제할 수 없습니다.');
    return;
  }
  const layer = getActiveLayer();
  if (!layer) return;
  if (confirm(`'${layer.name}' 레이어를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) { // 참고: undo로 되돌릴 수 있음
    layers = layers.filter(l => l.id !== layer.id);
    
    // 다른 레이어 활성화
    activeLayerId = layers[layers.length - 1].id;
    selectedModuleId = null;

    renderAll();
    updateEditPanel();
    saveState();
    showToast(`레이어 삭제됨`);
  }
}

function activateLayer(layerId) {
  if (activeLayerId === layerId) return; // 이미 활성
  activeLayerId = layerId;
  selectedModuleId = null; // 레이어 변경 시 선택 해제
  
  // UI 갱신 (히스토리 저장 없음 - 단순 뷰 변경)
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
    event.target.textContent = newName; // 공백 제거
    saveState();
    showToast('레이어 이름 변경됨');
  } else {
    event.target.textContent = layer.name; // 원래 이름 복구
  }
}

function handleLayerRenameKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
    }
}

function toggleLayerVisibility(event, layerId) {
  event.stopPropagation(); // 부모 <li>의 activateLayer 방지
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  layer.isVisible = !layer.isVisible;
  renderLayersList();
  renderCanvas();
  saveState();
}

function toggleLayerLock(event, layerId) {
  event.stopPropagation(); // 부모 <li>의 activateLayer 방지
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
  if (!layer) {
    showToast('활성 레이어가 없습니다.');
    return;
  }
  if (layer.isLocked) {
    showToast('잠긴 레이어에는 추가할 수 없습니다.');
    return;
  }

  const col = clamp(parseInt(document.getElementById('custom-col').value) || 2, 1, desktopColumns);
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
  if (mobileOrderLocked) {
    layer.mobileOrder = [...layer.desktopOrder];
  } else {
    layer.mobileOrder.push(newModule.id);
  }
  
  // 입력 필드 초기화
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
  // 1. 레이어 활성화 (필요시)
  if (activeLayerId !== layerId) {
      activateLayer(layerId);
  }
  
  // 2. 모듈 선택
  if (selectedModuleId === moduleId) return; // 이미 선택됨
  selectedModuleId = moduleId;
  
  updateEditPanel();
  renderCanvas(); // 선택 상태(.selected) 갱신
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
  const layer = getActiveLayer();
  const module = getSelectedModule();
  if (!layer || !module) return;
  
  // deleteModule 함수 재사용
  deleteModule(layer.id, module.id, new Event('click'));
}

function splitSelectedModule() {
  const layer = getActiveLayer();
  const module = getSelectedModule();
  if (!layer || !module) {
    showToast('분할할 모듈을 먼저 선택하세요.');
    return;
  }
  if (layer.isLocked) {
    showToast('잠긴 레이어의 모듈은 분할할 수 없습니다.');
    return;
  }

  const h = parseInt(document.getElementById('split-h').value) || 1;
  const v = parseInt(document.getElementById('split-v').value) || 1;

  if (h === 1 && v === 1) return;
  if (module.col % h !== 0 || module.row % v !== 0) {
    showToast(`분할 오류: 모듈 크기 (Col: ${module.col}, Row: ${module.row})가 입력 값 (H: ${h}, V: ${v})으로 나누어 떨어지지 않습니다.`);
    return;
  }

  const newCol = module.col / h;
  const newRow = module.row / v;
  const newGroupId = 'split-' + Date.now();
  const totalNewModules = h * v;
  let newModules = [];
  let newModuleIds = [];

  for (let i = 0; i < totalNewModules; i++) {
    const newModule = {
      ...deepCopy(module),
      id: Date.now() + i,
      col: newCol,
      row: newRow,
      groupId: newGroupId,
    };
    newModules.push(newModule);
    newModuleIds.push(newModule.id);
  }

  // --- 기존 모듈을 새 모듈들로 교체 ---
  const originalIndex = layer.modules.findIndex(m => m.id === module.id);
  const originalId = module.id;

  if (originalIndex > -1) {
      layer.modules.splice(originalIndex, 1, ...newModules);
  }

  const desktopOrderIndex = layer.desktopOrder.indexOf(originalId);
  if (desktopOrderIndex > -1) {
    layer.desktopOrder.splice(desktopOrderIndex, 1, ...newModuleIds);
  }

  const mobileOrderIndex = layer.mobileOrder.indexOf(originalId);
  if (mobileOrderIndex > -1) {
    layer.mobileOrder.splice(mobileOrderIndex, 1, ...newModuleIds);
  }

  selectedModuleId = null; // 분할 후 선택 해제
  updateEditPanel();
  showToast(`${module.col}x${module.row} 모듈을 ${h}x${v} (${totalNewModules}개)로 분할했습니다.`);
  renderCanvas();
  updateStats();
  updateCode();
  saveState();
}

function clearActiveLayer() {
  const layer = getActiveLayer();
  if (!layer) return;
  if (layer.isLocked) {
    showToast('잠긴 레이어는 비울 수 없습니다.');
    return;
  }
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

// === [수정] 드래그 앤 드롭 (활성 레이어 내에서만) ===

function handleDragStart(layerId, moduleId, moduleIndexInOrder, event) {
  const layer = layers.find(l => l.id === layerId);
  if (!layer || layer.isLocked) {
      event.preventDefault();
      return;
  }
  
  draggedModuleInfo = { layerId, moduleId, moduleIndexInOrder };
  event.target.closest('.module').classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', moduleId);
}

function handleDragEnd(event) {
  document.querySelectorAll('.module.dragging').forEach(el => el.classList.remove('dragging'));
  draggedModuleInfo = null;
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleDrop(targetLayerId, targetModuleIndexInOrder, event) {
  event.preventDefault();
  event.stopPropagation();
  
  if (!draggedModuleInfo || draggedModuleInfo.layerId !== targetLayerId) {
      draggedModuleInfo = null;
      return; // 다른 레이어 간 드롭 방지
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

  // 드롭 대상이 '캔버스 배경'인 경우 (targetModuleIndexInOrder가 null)
  if (targetModuleIndexInOrder === null) {
      // 그룹이 아닌 경우, 마지막으로 드롭
      if (!groupId) {
          let newOrder = order.filter(id => id !== draggedId);
          newOrder.push(draggedId);
          if (currentView === 'desktop') {
              layer.desktopOrder = newOrder;
              if (mobileOrderLocked) layer.mobileOrder = [...newOrder];
          } else {
              layer.mobileOrder = newOrder;
          }
          renderCanvas();
          saveState();
      }
      draggedModuleInfo = null;
      return;
  }
  
  // 드롭 대상이 '다른 모듈'인 경우
  const targetId = order[targetModuleIndexInOrder];
  if (idsToMove.includes(targetId)) {
      draggedModuleInfo = null;
      return; // 자기 그룹에 드롭
  }

  let newOrder = order.filter(id => !idsToMove.includes(id));
  let newDropIndex = newOrder.indexOf(targetId);
  
  // 드래그 방향에 따라 인덱스 보정 (앞 -> 뒤 vs 뒤 -> 앞)
  if (draggedModuleInfo.moduleIndexInOrder < targetModuleIndexInOrder) {
      newDropIndex += 1;
  }

  newOrder.splice(newDropIndex, 0, ...idsToMove);

  if (currentView === 'desktop') {
    layer.desktopOrder = newOrder;
    if (mobileOrderLocked) {
      layer.mobileOrder = [...layer.desktopOrder];
    }
  } else {
    layer.mobileOrder = newOrder;
  }
  
  renderCanvas();
  saveState();
  draggedModuleInfo = null;
}


// === [수정] 코드 생성 (모든 레이어) ===

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
  padding: ${desktopGap}px;
}

/* [신규] 레이어 중첩 래퍼 */
.grid-viewport-wrapper {
  position: relative;
  max-width: ${1280 - (desktopGap * 2)}px; /* 예시 최대 너비 */
  margin: 0 auto;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(${desktopColumns}, 1fr);
  gap: ${desktopGap}px;
}

/* [신규] 레이어 중첩 스타일 */
.grid-viewport-wrapper .grid-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  /* 비활성 레이어 클릭 방지 */
  pointer-events: none;
}
/* 활성 레이어(가장 위)만 클릭 가능 */
.grid-viewport-wrapper .grid-container:last-of-type {
  position: relative; /* 스태킹 컨텍스트에서 높이 차지 */
  pointer-events: auto;
}


.module {
  min-height: 60px;
}
.module.type-image { background: #e0e0e0; }
.module.type-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.module.type-text { background: #ffffff; padding: 10px; }

/* [신규] 모든 레이어의 모듈 스타일 생성 */
`;

  layers.forEach(layer => {
    if (!layer.isVisible) return;
    
    css += `\n/* --- Layer: ${layer.name} --- */\n`;
    
    layer.modules.forEach(m => {
      const desktopColSpan = clamp(m.col, 1, desktopColumns);
      const isTransparent = m.transparent || false;
      const bgColor = isTransparent ? 'transparent' : (m.color || '#8c6c3c');
      const borderWidth = m.borderWidth || 0;
      const borderColor = m.borderColor || '#000000';
      const outlineStyle = borderWidth > 0 ? `\n  outline: ${borderWidth}px solid ${borderColor};\n  outline-offset: -${borderWidth}px;` : '';
      const backgroundStyle = (m.type === 'box' || !m.type) ? `background: ${bgColor};` : '';
      const aspectStyle = m.aspectRatio ? `\n  aspect-ratio: ${m.aspectRatio};` : '';

      css += `.module-${m.id} {
  grid-column: span ${desktopColSpan};
  grid-row: span ${m.row};
  ${backgroundStyle}${outlineStyle}${aspectStyle}
}\n`;
    });
  });

  css += `

/* 모바일 반응형 - ${getModeLabel(responsiveMode)} */
@media (max-width: 768px) {
  body { padding: ${mobileGap}px; }
  
  .grid-viewport-wrapper .grid-container {
    grid-template-columns: repeat(${targetColumns}, 1fr);
    gap: ${mobileGap}px;
    position: relative; /* 모바일에서는 중첩 대신 순서대로 */
  }
  
`;

  layers.forEach(layer => {
    if (!layer.isVisible) return;
    
    css += `\n  /* --- Layer: ${layer.name} (Mobile) --- */\n`;
    
    layer.mobileOrder.forEach((id, i) => {
      const m = layer.modules.find(mod => mod.id === id);
      if (!m) return '';

      const mobileSpan = getMobileSpan(m);
      const comment = m.mobileCol !== null ? ' /* 수동 */' : ` /* 자동: min(${m.col}, ${targetColumns}) */`;
      
      css += `  .module-${m.id} {
    grid-column: span ${mobileSpan};${comment}
    grid-row: span ${m.row};
    order: ${i};
  }\n`;
    });
  });

  css += '\n}\n';
  return css;
}


// === [수정] UI 컨트롤 및 이벤트 핸들러 ===

function init() {
  // --- 글로벌 설정 리스너 ---
  document.getElementById('columns').addEventListener('input', e => { 
    desktopColumns = clamp(parseInt(e.target.value) || 1, 1, 12);
    updateStats(); updateModeHint(); updateMobileSpanHint(); renderCanvas(); 
  });
  document.getElementById('columns').addEventListener('change', e => { saveState(); });

  document.getElementById('gap').addEventListener('input', e => { 
    desktopGap = clamp(parseInt(e.target.value) || 0, 0, 50);
    updateStats(); renderCanvas(); 
  });
  document.getElementById('gap').addEventListener('change', e => { saveState(); });

  document.getElementById('target-columns').addEventListener('input', e => { 
    targetColumns = clamp(parseInt(e.target.value) || 1, 1, 12); 
    updateModeHint(); updateMobileSpanHint(); updateCode(); renderCanvas();
  });
  document.getElementById('target-columns').addEventListener('change', e => { saveState(); });
  
  document.getElementById('canvas-scale').addEventListener('input', e => {
    renderCanvas(); // 배율 변경은 캔버스 렌더링
  });

  document.getElementById('show-selection').addEventListener('change', e => {
    showSelection = e.target.checked;
    renderCanvas(); // 히스토리 저장 없음
  });
  
  // --- 모듈 편집 리스너 (활성 레이어의 선택된 모듈에 적용) ---
  function addEditListener(elementId, eventType, property, valueFn, doSaveState = false) {
    document.getElementById(elementId).addEventListener(eventType, e => {
      const module = getSelectedModule();
      if (module) {
        module[property] = valueFn(e);
        renderCanvas();
        if(property === 'col' || property === 'mobileCol') updateMobileSpanHint();
        if (doSaveState) saveState();
      }
    });
  }
  
  // input/change 이벤트를 분리하여 히스토리 저장 최적화
  addEditListener('edit-type', 'change', 'type', e => e.target.value, true);
  addEditListener('edit-group-id', 'change', 'groupId', e => e.target.value.trim() || null, true);
  
  addEditListener('edit-col', 'input', 'col', e => clamp(parseInt(e.target.value) || 1, 1, desktopColumns));
  addEditListener('edit-col', 'change', 'col', e => clamp(parseInt(e.target.value) || 1, 1, desktopColumns), true);
  
  addEditListener('edit-row', 'input', 'row', e => clamp(parseInt(e.target.value) || 1, 1, 99));
  addEditListener('edit-row', 'change', 'row', e => clamp(parseInt(e.target.value) || 1, 1, 99), true);
  
  addEditListener('edit-mobile-col', 'input', 'mobileCol', e => e.target.value === '' ? null : clamp(parseInt(e.target.value) || 1, 1, targetColumns));
  addEditListener('edit-mobile-col', 'change', 'mobileCol', e => e.target.value === '' ? null : clamp(parseInt(e.target.value) || 1, 1, targetColumns), true);

  addEditListener('edit-aspect-ratio', 'change', 'aspectRatio', e => e.target.checked ? '1 / 1' : null, true);
  
  addEditListener('edit-color', 'input', 'color', e => e.target.value);
  addEditListener('edit-color', 'change', 'color', e => e.target.value, true);
  
  addEditListener('edit-border-color', 'input', 'borderColor', e => e.target.value);
  addEditListener('edit-border-color', 'change', 'borderColor', e => e.target.value, true);
  
  addEditListener('edit-border-width', 'input', 'borderWidth', e => clamp(parseInt(e.target.value) || 0, 0, 20));
  addEditListener('edit-border-width', 'change', 'borderWidth', e => clamp(parseInt(e.target.value) || 0, 0, 20), true);
  
  // --- 초기화 ---
  addLayer(); // 'Layer 1' 추가 및 활성화 (이때 saveState가 호출됨)
  // saveState(); // 초기 상태 저장 (addLayer가 이미 호출함)
}

function updateEditPanel() {
  const panel = document.getElementById('edit-panel');
  const module = getSelectedModule();
  
  if (!module) {
    panel.style.display = 'none';
    return;
  }
  
  panel.style.display = 'block';
  
  document.getElementById('edit-type').value = module.type || 'box';
  document.getElementById('edit-group-id').value = module.groupId || '';
  
  document.getElementById('edit-col').value = clamp(module.col, 1, desktopColumns);
  document.getElementById('edit-col').max = desktopColumns;
  document.getElementById('edit-row').value = module.row;
  document.getElementById('edit-mobile-col').value = module.mobileCol !== null ? clamp(module.mobileCol, 1, targetColumns) : '';
  document.getElementById('edit-mobile-col').max = targetColumns;
  
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

// [수정] 캔버스 클릭 (배경 클릭 시 선택 해제)
function handleCanvasClick(event) {
  if (event.target.id === 'canvas-viewport' || event.target.classList.contains('grid-container')) {
    deselectModule();
  }
}

// [수정] 모바일 스팬 계산
function calculateMobileSpan(desktopCol, desktopCols, targetCols) {
  return Math.max(1, Math.min(desktopCol, targetCols));
}
function getMobileSpan(module) {
  if(module.mobileCol !== undefined && module.mobileCol !== null && module.mobileCol !== '') {
    const clampedTarget = Math.min(module.mobileCol, targetColumns);
    return Math.max(1, clampedTarget);
  }
  return calculateMobileSpan(module.col, desktopColumns, targetColumns);
}

// [수정] 각종 UI 업데이트
function updateStats() {
  const layer = getActiveLayer();
  document.getElementById('stat-columns').textContent = `${desktopColumns}개`;
  document.getElementById('stat-gap').textContent = `${desktopGap}px`;
  document.getElementById('stat-modules').textContent = layer ? `${layer.modules.length}개` : '0개';
}
function updateModeHint() {
  document.getElementById('mode-hint').textContent = `${desktopColumns}열 → ${targetColumns}열로 리플로우`;
}
function updateMobileSpanHint() {
  const module = getSelectedModule();
  if(!module) return;
  const auto = calculateMobileSpan(module.col, desktopColumns, targetColumns);
  document.getElementById('mobile-span-hint').textContent = `자동: ${auto}열 (min(${module.col}열, ${targetColumns}열))`;
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

// [수정] 뷰 전환
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.view-btn[onclick="switchView('${view}')"]`).classList.add('active');
  deselectModule(); // 뷰 전환 시 선택 해제
  renderCanvas();
}

function toggleMobileOrderLock(event) {
  mobileOrderLocked = event.target.checked;
  const layer = getActiveLayer();
  if (mobileOrderLocked && layer) {
    layer.mobileOrder = [...layer.desktopOrder];
    showToast('모바일 순서가 데스크톱에 동기화됩니다.');
    renderCanvas();
    saveState();
  } else {
    showToast('모바일 순서 동기화 해제');
  }
}

// [수정] 나머지 유틸리티 함수
function toggleColorPicker(prefix, isTransparent) {
  const colorInput = document.getElementById(prefix + '-color');
  colorInput.disabled = isTransparent;
  colorInput.style.opacity = isTransparent ? 0.5 : 1;
  if (prefix === 'edit') {
      const module = getSelectedModule();
      if (module && module.transparent !== isTransparent) {
          module.transparent = isTransparent;
          renderCanvas();
          saveState();
      }
  }
}
function selectMode(mode) {
  if (mode !== 'reflow') { showToast('이 모드는 현재 지원되지 않습니다.'); return; }
  responsiveMode = mode;
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
