export function createMenuFeature(deps) {
  const {
    joinPanel,
    stepName,
    stepCrime,
    stepColor,
    joinError,
    colorGrid,
    customColorInput,
    colorChoices,
    getSelectedColor,
    setSelectedColor,
  } = deps;

  function setStep(step) {
    const showName = step === 'name';
    const showCrime = step === 'crime';
    const showColor = step === 'color';
    if (joinPanel) {
      joinPanel.classList.toggle('join-panel-centered', showCrime);
    }
    stepName.classList.toggle('active', showName);
    if (stepCrime) {
      stepCrime.classList.toggle('active', showCrime);
    }
    stepColor.classList.toggle('active', showColor);
  }

  function setJoinError(text = '') {
    joinError.textContent = text;
  }

  function selectColor(color) {
    const next = String(color || '').toLowerCase();
    setSelectedColor(next);
    customColorInput.value = next;

    for (const node of colorGrid.querySelectorAll('.color-swatch')) {
      const selected = node.dataset.color === next;
      node.classList.toggle('selected', selected);
      node.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  }

  function populateColorGrid() {
    colorGrid.innerHTML = '';
    const selectedColor = getSelectedColor();
    colorChoices.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-swatch';
      button.style.background = color;
      button.title = color;
      button.dataset.color = color;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', color === selectedColor ? 'true' : 'false');
      if (color === selectedColor) {
        button.classList.add('selected');
      }

      button.addEventListener('click', () => {
        selectColor(color);
      });

      colorGrid.appendChild(button);
    });
  }

  return {
    setStep,
    setJoinError,
    populateColorGrid,
    selectColor,
  };
}

