/**
 * quiz-player.js  —  PreseMaker Website Export
 *
 * Reads window.QUIZ_DATA (a serialised QuizBank object inlined by the
 * website export service) and renders an interactive quiz.
 *
 * Supported question types:  MC  TF  MS  SA  M  O  WR
 *
 * QUIZ_DATA shape (PascalCase, matches C# System.Text.Json defaults):
 *   { Questions: [ { Id, Type, Title, QuestionText, Hint, Feedback,
 *                    Options, TrueWeight, FalseWeight, MultiselectOptions,
 *                    Choices, Matches, Answers, Items, AnswerKey, ... } ] }
 *   Type values: "MC" | "TF" | "MS" | "SA" | "M" | "O" | "WR"
 *   (also accepts numeric enum 0-6 as fallback)
 */

const QuizPlayer = (function () {

  // ── State ─────────────────────────────────────────────────────────────

  let _questions     = [];
  let _mode          = 'one';   // 'one' | 'all'
  let _currentIndex  = 0;
  let _answers       = {};      // id → answer value
  let _shuffledOrder = {};      // id → shuffled index array  (Ordering questions)
  let _submitted     = false;

  // ── Type helpers ──────────────────────────────────────────────────────

  const TYPE_NAMES = ['WR','SA','M','MC','TF','MS','O'];

  function typeStr(q) {
    return typeof q.Type === 'number' ? (TYPE_NAMES[q.Type] || 'WR') : (q.Type || 'WR');
  }

  const TYPE_LABELS = {
    WR: 'Written Response', SA: 'Short Answer', M: 'Matching',
    MC: 'Multiple Choice',  TF: 'True / False', MS: 'Multiselect',
    O:  'Ordering'
  };

  // ── Initialisation ────────────────────────────────────────────────────

  function init() {
    const root = document.getElementById('quiz-root');
    if (!root) return;

    if (typeof QUIZ_DATA === 'undefined' || !QUIZ_DATA || !Array.isArray(QUIZ_DATA.Questions) || QUIZ_DATA.Questions.length === 0) {
      root.innerHTML = '<p class="quiz-empty">No questions found in this quiz bank.</p>';
      return;
    }

    _questions = QUIZ_DATA.Questions;

    // Pre-shuffle ordering questions
    _questions.forEach(q => {
      if (typeStr(q) === 'O' && Array.isArray(q.Items) && q.Items.length > 0) {
        const indices = [...Array(q.Items.length).keys()];
        _shuffledOrder[q.Id] = shuffle(indices);
      }
    });

    renderModeToggle();
    renderMode();
  }

  // ── Mode toggle ───────────────────────────────────────────────────────

  function renderModeToggle() {
    const container = document.getElementById('quiz-mode-toggle');
    if (!container) return;
    container.innerHTML =
      '<div class="mode-toggle">' +
        '<button id="btn-mode-one" class="mode-btn active" onclick="QuizPlayer.setMode(\'one\')">One at a time</button>' +
        '<button id="btn-mode-all" class="mode-btn"        onclick="QuizPlayer.setMode(\'all\')">All questions</button>' +
      '</div>';
  }

  function setMode(mode) {
    if (_submitted) return;
    _mode = mode;
    const btnOne = document.getElementById('btn-mode-one');
    const btnAll = document.getElementById('btn-mode-all');
    if (btnOne) btnOne.classList.toggle('active', mode === 'one');
    if (btnAll) btnAll.classList.toggle('active', mode === 'all');
    renderMode();
  }

  function renderMode() {
    if (_mode === 'one') renderOneAtATime();
    else renderAllAtOnce();
  }

  // ── One-at-a-time mode ────────────────────────────────────────────────

  function renderOneAtATime() {
    const qRoot   = document.getElementById('quiz-questions');
    if (!qRoot) return;
    const q       = _questions[_currentIndex];
    const total   = _questions.length;
    const pct     = Math.round((_currentIndex + 1) / total * 100);
    const isLast  = _currentIndex === total - 1;
    const isFirst = _currentIndex === 0;

    qRoot.innerHTML =
      '<div class="progress-label">Question ' + (_currentIndex + 1) + ' of ' + total + '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      renderQuestionHtml(q, _currentIndex) +
      '<div class="nav-buttons">' +
        (isFirst ? '<span></span>' : '<button class="btn-nav" onclick="QuizPlayer.prev()">← Previous</button>') +
        (isLast
          ? '<button class="btn-submit" onclick="QuizPlayer.submit()">Submit Quiz</button>'
          : '<button class="btn-nav" onclick="QuizPlayer.next()">Next →</button>') +
      '</div>';

    restoreAnswer(q);
  }

  // ── All-at-once mode ──────────────────────────────────────────────────

  function renderAllAtOnce() {
    const qRoot = document.getElementById('quiz-questions');
    if (!qRoot) return;
    let html = '';
    _questions.forEach((q, i) => { html += renderQuestionHtml(q, i); });
    html += '<div class="submit-area"><button class="btn-submit" onclick="QuizPlayer.submit()">Submit Quiz</button></div>';
    qRoot.innerHTML = html;
    _questions.forEach(q => restoreAnswer(q));
  }

  // ── Question HTML renderers ───────────────────────────────────────────

  function renderQuestionHtml(q, index) {
    const t     = typeStr(q);
    const label = TYPE_LABELS[t] || t;
    let body;
    switch (t) {
      case 'MC': body = renderMC(q);       break;
      case 'TF': body = renderTF(q);       break;
      case 'MS': body = renderMS(q);       break;
      case 'SA': body = renderSA(q);       break;
      case 'M':  body = renderMatching(q); break;
      case 'O':  body = renderOrdering(q); break;
      case 'WR': body = renderWR(q);       break;
      default:   body = '<p class="quiz-empty">Question type not supported.</p>';
    }
    const hintHtml = q.Hint
      ? '<div class="hint"><strong>Hint:</strong> ' + esc(q.Hint) + '</div>'
      : '';
    return (
      '<div class="question-card" data-id="' + esc(q.Id) + '" data-type="' + t + '">' +
        '<div class="question-header">' +
          '<span class="question-num">' + (index + 1) + '.</span>' +
          '<span class="type-badge">' + esc(label) + '</span>' +
        '</div>' +
        '<div class="question-text">' + esc(q.QuestionText) + '</div>' +
        body +
        hintHtml +
      '</div>'
    );
  }

  function renderMC(q) {
    if (!Array.isArray(q.Options)) return '';
    return q.Options.map((opt, i) =>
      '<label class="option-label">' +
        '<input type="radio" name="q_' + q.Id + '" value="' + i + '"' +
          ' onchange="QuizPlayer.saveAnswer(\'' + q.Id + '\',' + i + ')">' +
        '<span>' + esc(opt.Text) + '</span>' +
      '</label>'
    ).join('');
  }

  function renderTF(q) {
    const rb = (val, label) =>
      '<label class="option-label">' +
        '<input type="radio" name="q_' + q.Id + '" value="' + val + '"' +
          ' onchange="QuizPlayer.saveAnswer(\'' + q.Id + '\',\'' + val + '\')">' +
        '<span>' + label + '</span>' +
      '</label>';
    return rb('true', 'True') + rb('false', 'False');
  }

  function renderMS(q) {
    if (!Array.isArray(q.MultiselectOptions)) return '';
    return q.MultiselectOptions.map((opt, i) =>
      '<label class="option-label">' +
        '<input type="checkbox" name="q_' + q.Id + '" value="' + i + '"' +
          ' onchange="QuizPlayer.saveAnswerMS(\'' + q.Id + '\')">' +
        '<span>' + esc(opt.Text) + '</span>' +
      '</label>'
    ).join('');
  }

  function renderSA(q) {
    return '<input type="text" class="sa-input" id="sa_' + q.Id + '"' +
      ' placeholder="Type your answer…"' +
      ' oninput="QuizPlayer.saveAnswer(\'' + q.Id + '\',this.value)">';
  }

  function renderMatching(q) {
    if (!Array.isArray(q.Choices) || !Array.isArray(q.Matches)) return '';
    const opts = q.Matches.map(m =>
      '<option value="' + m.ChoiceNumber + '">' + esc(m.Text) + '</option>'
    ).join('');
    const rows = q.Choices.map(c =>
      '<tr>' +
        '<td class="match-prompt">' + c.Number + '.&nbsp;' + esc(c.Text) + '</td>' +
        '<td><select class="match-select"' +
          ' data-qid="' + q.Id + '" data-choice="' + c.Number + '"' +
          ' onchange="QuizPlayer.saveAnswerM(\'' + q.Id + '\')">' +
          '<option value="">— select —</option>' + opts +
        '</select></td>' +
      '</tr>'
    ).join('');
    return '<table class="matching-table"><tbody>' + rows + '</tbody></table>';
  }

  function renderOrdering(q) {
    if (!Array.isArray(q.Items) || q.Items.length === 0) return '';
    const shuffled = _shuffledOrder[q.Id] || q.Items.map((_, i) => i);
    const items = shuffled.map((origIdx, displayPos) => {
      const item = q.Items[origIdx];
      return '<li class="ordering-item" data-orig="' + origIdx + '" draggable="true"' +
        ' ondragstart="QuizPlayer.dragStart(event)"' +
        ' ondragover="QuizPlayer.dragOver(event)"' +
        ' ondrop="QuizPlayer.dragDrop(event,\'' + q.Id + '\')"' +
        ' ondragleave="QuizPlayer.dragLeave(event)">' +
        '<span class="drag-handle">⠿</span>' +
        '<span class="item-text">' + esc(item.Text) + '</span>' +
        '<span class="order-arrows">' +
          '<button onclick="QuizPlayer.moveItem(\'' + q.Id + '\',this,-1)" title="Move up">▲</button>' +
          '<button onclick="QuizPlayer.moveItem(\'' + q.Id + '\',this,1)"  title="Move down">▼</button>' +
        '</span>' +
      '</li>';
    }).join('');
    return '<ul class="ordering-list" id="ol_' + q.Id + '">' + items + '</ul>';
  }

  function renderWR(q) {
    const keyHtml = (q.AnswerKey && typeof q.AnswerKey === 'string' && q.AnswerKey.trim())
      ? '<p class="wr-note" style="color:#666"><strong>Answer guidance:</strong> ' + esc(q.AnswerKey) + '</p>'
      : '';
    return (
      '<textarea class="wr-textarea" id="wr_' + q.Id + '"' +
        ' placeholder="Write your response here…"' +
        ' oninput="QuizPlayer.saveAnswer(\'' + q.Id + '\',this.value)"></textarea>' +
      '<p class="wr-note">📝 Written responses require instructor review.</p>' +
      keyHtml
    );
  }

  // ── Answer management ─────────────────────────────────────────────────

  function saveAnswer(id, value) { _answers[id] = value; }

  function saveAnswerMS(id) {
    const checked = document.querySelectorAll('input[name="q_' + id + '"]:checked');
    _answers[id] = Array.from(checked).map(b => parseInt(b.value));
  }

  function saveAnswerM(id) {
    const selects = document.querySelectorAll('select[data-qid="' + id + '"]');
    const map = {};
    selects.forEach(s => { if (s.value !== '') map[s.dataset.choice] = parseInt(s.value); });
    _answers[id] = map;
  }

  function saveAnswerOrdering(qId) {
    const items = document.querySelectorAll('#ol_' + qId + ' li');
    _answers[qId] = Array.from(items).map(li => parseInt(li.dataset.orig));
  }

  function restoreAnswer(q) {
    const v = _answers[q.Id];
    if (v === undefined || v === null) return;
    const t = typeStr(q);
    if (t === 'MC' || t === 'TF') {
      const rb = document.querySelector('input[name="q_' + q.Id + '"][value="' + v + '"]');
      if (rb) rb.checked = true;
    } else if (t === 'MS' && Array.isArray(v)) {
      v.forEach(i => {
        const cb = document.querySelector('input[name="q_' + q.Id + '"][value="' + i + '"]');
        if (cb) cb.checked = true;
      });
    } else if (t === 'SA') {
      const el = document.getElementById('sa_' + q.Id);
      if (el) el.value = v;
    } else if (t === 'WR') {
      const el = document.getElementById('wr_' + q.Id);
      if (el) el.value = v;
    }
    // M and O restore is complex (DOM-dependent); skipped — user re-enters on nav
  }

  // ── Drag-and-drop for ordering ────────────────────────────────────────

  let _dragSrc = null;

  function dragStart(e) {
    _dragSrc = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
  }
  function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
  function dragDrop(e, qId) {
    e.preventDefault();
    const target = e.currentTarget;
    target.classList.remove('drag-over');
    if (!_dragSrc || _dragSrc === target) return;
    const list = document.getElementById('ol_' + qId);
    if (!list) return;
    const items = Array.from(list.children);
    const srcIdx = items.indexOf(_dragSrc);
    const tgtIdx = items.indexOf(target);
    if (srcIdx < tgtIdx) list.insertBefore(_dragSrc, target.nextSibling);
    else                  list.insertBefore(_dragSrc, target);
    saveAnswerOrdering(qId);
  }

  function moveItem(qId, btn, dir) {
    const list = document.getElementById('ol_' + qId);
    const li   = btn.closest('li');
    if (!list || !li) return;
    if (dir === -1 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
    if (dir ===  1 && li.nextElementSibling)     list.insertBefore(li.nextElementSibling, li);
    saveAnswerOrdering(qId);
  }

  // ── Navigation ────────────────────────────────────────────────────────

  function saveCurrentForNav() {
    const q = _questions[_currentIndex];
    if (!q) return;
    const t = typeStr(q);
    if (t === 'MS') saveAnswerMS(q.Id);
    else if (t === 'M') saveAnswerM(q.Id);
    else if (t === 'O') saveAnswerOrdering(q.Id);
  }

  function next() {
    saveCurrentForNav();
    if (_currentIndex < _questions.length - 1) { _currentIndex++; renderOneAtATime(); }
  }

  function prev() {
    saveCurrentForNav();
    if (_currentIndex > 0) { _currentIndex--; renderOneAtATime(); }
  }

  // ── Submit ────────────────────────────────────────────────────────────

  function submit() {
    if (_mode === 'one') saveCurrentForNav();
    else {
      _questions.forEach(q => {
        const t = typeStr(q);
        if (t === 'MS') saveAnswerMS(q.Id);
        else if (t === 'M') saveAnswerM(q.Id);
        else if (t === 'O') saveAnswerOrdering(q.Id);
      });
    }
    _submitted = true;
    renderResults();
  }

  // ── Scoring ───────────────────────────────────────────────────────────

  function scoreQuestion(q) {
    const t   = typeStr(q);
    const ans = _answers[q.Id];

    if (ans === undefined || ans === null || ans === '') return null;

    switch (t) {
      case 'MC': {
        const idx = parseInt(ans);
        if (!Array.isArray(q.Options) || isNaN(idx) || idx >= q.Options.length) return 0;
        return q.Options[idx].Weight;   // 0-100 scale
      }
      case 'TF':
        return ans === 'true' ? (q.TrueWeight || 0) : (q.FalseWeight || 0);

      case 'MS': {
        if (!Array.isArray(q.MultiselectOptions) || !Array.isArray(ans)) return 0;
        const n = q.MultiselectOptions.length;
        if (n === 0) return 0;
        let pts = 0;
        q.MultiselectOptions.forEach((opt, i) => {
          const sel = ans.includes(i);
          if (opt.IsCorrect && sel)   pts++;
          if (!opt.IsCorrect && !sel) pts++;
        });
        return Math.round(pts / n * 100);
      }
      case 'SA': {
        if (!Array.isArray(q.Answers)) return 0;
        const userTrimmed = String(ans).trim().toLowerCase();
        for (const a of q.Answers) {
          let matched = false;
          if (a.IsRegex) {
            try { matched = new RegExp(a.Text, 'i').test(ans); } catch { matched = false; }
          } else {
            matched = userTrimmed === a.Text.trim().toLowerCase();
          }
          if (matched) return a.Weight;
        }
        return 0;
      }
      case 'M': {
        if (!Array.isArray(q.Matches) || !ans || typeof ans !== 'object') return 0;
        let correct = 0;
        q.Matches.forEach(m => {
          if (parseInt(ans[m.ChoiceNumber]) === m.ChoiceNumber) correct++;
        });
        return q.Matches.length > 0 ? Math.round(correct / q.Matches.length * 100) : 0;
      }
      case 'O': {
        if (!Array.isArray(q.Items) || !Array.isArray(ans)) return 0;
        let correct = 0;
        ans.forEach((origIdx, pos) => { if (origIdx === pos) correct++; });
        return q.Items.length > 0 ? Math.round(correct / q.Items.length * 100) : 0;
      }
      case 'WR': return null;   // instructor-graded
      default:   return null;
    }
  }

  // ── Results rendering ─────────────────────────────────────────────────

  function renderResults() {
    const scored    = _questions.map(q => ({ q, score: scoreQuestion(q) }));
    const gradable  = scored.filter(s => s.score !== null);
    const earned    = gradable.reduce((sum, s) => sum + s.score, 0);
    const pct       = gradable.length > 0 ? Math.round(earned / (gradable.length * 100) * 100) : 0;
    const correct   = gradable.filter(s => s.score >= 100).length;
    const ungraded  = scored.length - gradable.length;

    let html =
      '<div class="results-header">' +
        '<h2>Quiz Results</h2>' +
        '<div class="score-circle">' +
          '<div class="score-pct">' + pct + '%</div>' +
          '<div class="score-sub">' + correct + ' / ' + gradable.length + ' correct</div>' +
        '</div>' +
        (ungraded > 0
          ? '<p class="wr-note">' + ungraded + ' written response question' + (ungraded > 1 ? 's' : '') +
            ' require instructor review.</p>'
          : '') +
        '<button class="btn-retake" onclick="QuizPlayer.retake()" style="margin-top:12px">Retake Quiz</button>' +
      '</div>' +
      '<div class="results-breakdown"><h3>Question Breakdown</h3>';

    scored.forEach(({ q, score }, i) => {
      const t       = typeStr(q);
      const ans     = _answers[q.Id];
      const cls     = score === null ? 'result-ungraded'
                    : score >= 100   ? 'result-correct'
                    : score > 0      ? 'result-partial'
                    :                  'result-wrong';
      const icon    = score === null ? '📝'
                    : score >= 100   ? '✓'
                    : score > 0      ? '◑'
                    :                  '✗';

      html +=
        '<div class="result-item ' + cls + '">' +
          '<div class="result-q">' +
            '<span class="result-icon">' + icon + '</span>' +
            '<strong>' + (i + 1) + '. ' + esc(q.QuestionText) + '</strong>' +
          '</div>' +
          '<div class="result-detail">' +
            '<span class="your-answer">Your answer: ' + formatAnswer(q, ans, t) + '</span>' +
            (score !== null && score < 100
              ? '<span class="correct-answer">Correct: ' + formatCorrect(q, t) + '</span>'
              : '') +
            (score !== null ? '<span class="score-detail">Score: ' + score + '%</span>' : '') +
            (q.Feedback ? '<span class="feedback">' + esc(q.Feedback) + '</span>' : '') +
          '</div>' +
        '</div>';
    });

    html += '</div>';
    document.getElementById('quiz-root').innerHTML = html;
  }

  function formatAnswer(q, ans, t) {
    if (ans === undefined || ans === null || ans === '') return '<em>Not answered</em>';
    switch (t) {
      case 'MC': {
        const idx = parseInt(ans);
        return (Array.isArray(q.Options) && q.Options[idx]) ? esc(q.Options[idx].Text) : '—';
      }
      case 'TF': return ans === 'true' ? 'True' : 'False';
      case 'MS': {
        if (!Array.isArray(ans) || ans.length === 0) return '<em>None selected</em>';
        return ans.map(i =>
          (Array.isArray(q.MultiselectOptions) && q.MultiselectOptions[i])
            ? esc(q.MultiselectOptions[i].Text) : '?'
        ).join(', ');
      }
      case 'SA': case 'WR': return esc(String(ans)) || '<em>No answer</em>';
      case 'M': {
        if (!ans || typeof ans !== 'object' || !Array.isArray(q.Choices)) return '—';
        return q.Choices.map(c => {
          const matched = Array.isArray(q.Matches)
            ? q.Matches.find(m => m.ChoiceNumber === parseInt(ans[c.Number]))
            : null;
          return c.Number + ' → ' + (matched ? esc(matched.Text) : '?');
        }).join('; ');
      }
      case 'O': {
        if (!Array.isArray(ans) || !Array.isArray(q.Items)) return '—';
        return ans.map(i => (q.Items[i] ? esc(q.Items[i].Text) : '?')).join(' → ');
      }
      default: return '—';
    }
  }

  function formatCorrect(q, t) {
    switch (t) {
      case 'MC': {
        const c = (q.Options || []).filter(o => o.Weight >= 100).map(o => esc(o.Text));
        return c.length > 0 ? c.join(' <em>or</em> ') : '—';
      }
      case 'TF': return q.TrueWeight >= 100 ? 'True' : 'False';
      case 'MS': {
        const c = (q.MultiselectOptions || []).filter(o => o.IsCorrect).map(o => esc(o.Text));
        return c.length > 0 ? c.join(', ') : '—';
      }
      case 'SA': {
        const c = (q.Answers || []).filter(a => a.Weight >= 100).map(a => esc(a.Text));
        return c.length > 0 ? c.join(' <em>or</em> ') : '—';
      }
      case 'M': {
        if (!Array.isArray(q.Matches) || !Array.isArray(q.Choices)) return '—';
        return q.Matches.map(m => {
          const ch = q.Choices.find(c => c.Number === m.ChoiceNumber);
          return (ch ? esc(ch.Text) : m.ChoiceNumber) + ' → ' + esc(m.Text);
        }).join('; ');
      }
      case 'O': return Array.isArray(q.Items) ? q.Items.map(i => esc(i.Text)).join(' → ') : '—';
      case 'WR': return q.AnswerKey ? esc(q.AnswerKey) : '<em>See instructor</em>';
      default:   return '—';
    }
  }

  // ── Retake ────────────────────────────────────────────────────────────

  function retake() {
    _answers    = {};
    _currentIndex = 0;
    _submitted  = false;
    // Re-shuffle ordering questions
    _questions.forEach(q => {
      if (typeStr(q) === 'O' && Array.isArray(q.Items) && q.Items.length > 0) {
        _shuffledOrder[q.Id] = shuffle([...Array(q.Items.length).keys()]);
      }
    });
    renderModeToggle();
    renderMode();
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ────────────────────────────────────────────────────────

  return {
    init, setMode, next, prev, submit, retake,
    saveAnswer, saveAnswerMS, saveAnswerM, saveAnswerOrdering, moveItem,
    dragStart, dragOver, dragLeave, dragDrop
  };

})();

window.addEventListener('DOMContentLoaded', QuizPlayer.init);