function splitSelectedModule() {
  const moduleInfo = getSelectedModule();
  if (!moduleInfo) { showToast('분할할 모듈을 먼저 선택하세요.'); return; }

  const { module, layer } = moduleInfo;
  if (layer.isLocked) { showToast('잠긴 레이어의 모듈은 분할할 수 없습니다.'); return; }

  const h = parseInt(document.getElementById('split-h').value) || 1;
  const v = parseInt(document.getElementById('split-v').value) || 1;

  if (h === 1 && v === 1) return;

  if (h > module.col || v > module.row) {
    showToast(`모듈 크기(${module.col}x${module.row})보다 더 잘게 쪼갤 수 없습니다.`);
    return;
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
    for (let c = 0; c < h; c++) { 
      const newCol = baseCol + (c < remainderCol ? 1 : 0);
      const newModule = {
        ...deepCopy(module),
        id: Date.now() + (r * h + c),
        col: newCol, 
        row: newRow, 
        groupId: newGroupId,
      };
      if (r > 0 || c > 0) {
        newModule.textContent = '';
      }
      
      // --- [수정된 부분] ---
      // 원본 모듈이 aspect-ratio를 가졌다면,
      // 새로 분할된 모듈도 새 크기에 맞는 aspect-ratio를 갖도록 수정
      if (newModule.aspectRatio) { 
        newModule.aspectRatio = `${newCol} / ${newRow}`;
      }
      // --- [수정 완료] ---

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
