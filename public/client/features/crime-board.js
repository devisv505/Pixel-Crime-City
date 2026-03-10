export function createCrimeBoardFeature(deps) {
  const {
    state,
    elements,
    sprites,
    normalizeHexColor,
    pageSize,
    refreshMs,
    isJoined,
    stepCrime,
  } = deps;

  function setCrimeBoardStatus(text = '') {
    if (elements.status) {
      elements.status.textContent = text;
    }
  }

  function normalizeCrimeBoardSearchQuery(raw) {
    return String(raw || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .slice(0, 16);
  }

  function drawCrimeBoardAvatar(canvasNode, bodyColor) {
    if (!canvasNode) return;
    const g = canvasNode.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvasNode.width, canvasNode.height);
    g.fillStyle = 'rgba(0, 0, 0, 0.32)';
    g.fillRect(7, 22, 14, 3);

    const matrix = sprites.down;
    const unit = 2;
    const startX = 6;
    const startY = 5;
    const palette = {
      '1': '#0f1620',
      '2': '#f0c39a',
      '3': normalizeHexColor(bodyColor, '#58d2ff'),
      '4': '#1a3452',
      '5': '#111111',
    };
    for (let row = 0; row < matrix.length; row += 1) {
      const line = matrix[row];
      for (let col = 0; col < line.length; col += 1) {
        const token = line[col];
        if (token === '.') continue;
        g.fillStyle = palette[token];
        g.fillRect(startX + col * unit, startY + row * unit, unit, unit);
      }
    }
  }

  function refreshCrimeBoardControls() {
    if (elements.page) {
      elements.page.textContent = `Page ${state.currentPage} / ${state.totalPages}`;
    }
    if (elements.searchBtn) {
      elements.searchBtn.disabled = state.loading;
    }
    if (elements.searchClearBtn) {
      elements.searchClearBtn.disabled = state.loading;
    }
    if (elements.prevBtn) {
      elements.prevBtn.disabled = state.loading || state.currentPage <= 1;
    }
    if (elements.nextBtn) {
      elements.nextBtn.disabled = state.loading || state.currentPage >= state.totalPages;
    }
  }

  function renderCrimeBoardRows() {
    if (!elements.list) return;
    elements.list.innerHTML = '';
    if (state.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'crime-board-row';
      empty.textContent = state.loading ? 'Loading...' : 'No crime records found.';
      elements.list.appendChild(empty);
      refreshCrimeBoardControls();
      return;
    }

    for (const entry of state.entries) {
      const row = document.createElement('div');
      row.className = 'crime-board-row';

      const rank = document.createElement('div');
      rank.className = 'crime-board-rank';
      rank.textContent = `#${entry.rank}`;
      row.appendChild(rank);

      const avatar = document.createElement('canvas');
      avatar.className = 'crime-board-avatar';
      avatar.width = 28;
      avatar.height = 28;
      drawCrimeBoardAvatar(avatar, entry.color);
      row.appendChild(avatar);

      const main = document.createElement('div');
      main.className = 'crime-board-main';
      const name = document.createElement('div');
      name.className = 'crime-board-name';
      name.textContent = entry.name || 'Unknown';
      main.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'crime-board-sub';
      sub.textContent = `id:${entry.profileTag || 'anon'} | ${entry.online ? 'online' : 'offline'}`;
      main.appendChild(sub);
      row.appendChild(main);

      const score = document.createElement('div');
      score.className = 'crime-board-score';
      const value = document.createElement('div');
      value.className = 'crime-board-score-value';
      value.textContent = `Crime ${Math.max(0, Number(entry.crimeRating) || 0)}`;
      score.appendChild(value);

      const colorLine = document.createElement('div');
      colorLine.className = 'crime-board-color';
      const swatch = document.createElement('span');
      swatch.className = 'crime-board-color-swatch';
      const safeColor = normalizeHexColor(entry.color, '#58d2ff');
      swatch.style.background = safeColor;
      colorLine.appendChild(swatch);
      const colorText = document.createElement('span');
      colorText.textContent = safeColor.toUpperCase();
      colorLine.appendChild(colorText);
      score.appendChild(colorLine);

      row.appendChild(score);
      elements.list.appendChild(row);
    }

    refreshCrimeBoardControls();
  }

  async function fetchCrimeBoardPage(page, silent = false) {
    const nextPage = Math.max(1, Math.round(Number(page) || 1));
    const requestToken = ++state.fetchToken;
    state.loading = true;
    if (!silent) {
      setCrimeBoardStatus('Loading crime board...');
    }
    refreshCrimeBoardControls();
    if (!silent) {
      state.entries = [];
      renderCrimeBoardRows();
    }

    try {
      const params = new URLSearchParams();
      params.set('page', String(nextPage));
      params.set('pageSize', String(pageSize));
      if (state.searchQuery) {
        params.set('q', state.searchQuery);
      }
      const response = await fetch(`/api/crime-leaderboard?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (requestToken !== state.fetchToken) return;

      state.currentPage = Math.max(1, Math.round(Number(payload.page) || 1));
      state.totalPages = Math.max(1, Math.round(Number(payload.totalPages) || 1));
      state.total = Math.max(0, Math.round(Number(payload.total) || 0));
      if (typeof payload.query === 'string') {
        state.searchQuery = normalizeCrimeBoardSearchQuery(payload.query);
        if (elements.searchInput) {
          elements.searchInput.value = state.searchQuery;
        }
      }
      state.entries = Array.isArray(payload.players) ? payload.players : [];
      renderCrimeBoardRows();
      if (state.total > 0) {
        setCrimeBoardStatus(
          state.searchQuery
            ? `Tracked profiles: ${state.total} | filter: "${state.searchQuery}"`
            : `Tracked profiles: ${state.total}`
        );
      } else if (state.searchQuery) {
        setCrimeBoardStatus(`No crime records found for "${state.searchQuery}".`);
      } else {
        setCrimeBoardStatus('No crime records yet.');
      }
    } catch {
      if (requestToken !== state.fetchToken) return;
      state.currentPage = 1;
      state.totalPages = 1;
      state.total = 0;
      state.entries = [];
      renderCrimeBoardRows();
      setCrimeBoardStatus('Failed to load crime board.');
    } finally {
      if (requestToken === state.fetchToken) {
        state.loading = false;
        refreshCrimeBoardControls();
      }
    }
  }

  function applyCrimeBoardSearch() {
    const nextQuery = normalizeCrimeBoardSearchQuery(elements.searchInput ? elements.searchInput.value : '');
    if (elements.searchInput) {
      elements.searchInput.value = nextQuery;
    }
    if (nextQuery === state.searchQuery && state.currentPage === 1 && !state.loading) {
      fetchCrimeBoardPage(1, true);
      return;
    }
    state.searchQuery = nextQuery;
    fetchCrimeBoardPage(1);
  }

  function clearCrimeBoardSearch() {
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }
    if (!state.searchQuery && !state.loading) return;
    state.searchQuery = '';
    fetchCrimeBoardPage(1);
  }

  function stopCrimeBoardRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function startCrimeBoardRefresh() {
    stopCrimeBoardRefresh();
    state.refreshTimer = window.setInterval(() => {
      const visible = stepCrime && stepCrime.classList.contains('active');
      if (!visible || isJoined()) return;
      fetchCrimeBoardPage(state.currentPage, true);
    }, refreshMs);
  }

  function openCrimeBoardPanel() {
    state.currentPage = 1;
    state.totalPages = 1;
    state.total = 0;
    state.entries = [];
    if (elements.searchInput) {
      elements.searchInput.value = state.searchQuery;
    }
    setCrimeBoardStatus('Loading crime board...');
    renderCrimeBoardRows();
    fetchCrimeBoardPage(1);
    startCrimeBoardRefresh();
  }

  function closeCrimeBoardPanel() {
    stopCrimeBoardRefresh();
  }

  return {
    setCrimeBoardStatus,
    normalizeCrimeBoardSearchQuery,
    drawCrimeBoardAvatar,
    refreshCrimeBoardControls,
    renderCrimeBoardRows,
    fetchCrimeBoardPage,
    applyCrimeBoardSearch,
    clearCrimeBoardSearch,
    stopCrimeBoardRefresh,
    startCrimeBoardRefresh,
    openCrimeBoardPanel,
    closeCrimeBoardPanel,
  };
}

