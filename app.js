    // Версия сборки. Публикуется в version.json и проверяется при каждом открытии:
    // если Telegram закешировал старую страницу — приложение само переоткроется
    // с адресом ?v=<актуальная версия>, минуя кэш Mini App.
    const APP_VERSION = 'v27';
    (function ensureFreshBuild() {
      try {
        const u = new URL(window.location.href);
        const current = u.searchParams.get('v');
        fetch('version.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            const want = (j && j.version) || APP_VERSION;
            // Важно сравнивать именно с параметром в адресе: даже если страница уже
            // новая, но открыта без ?v= (или со старым), Telegram будет кэшировать
            // её по старому ключу. Переоткрываем с канонической версией.
            if (current !== want) {
              u.searchParams.set('v', want);
              window.location.replace(u.toString());
            }
          })
          .catch(() => { /* оффлайн или локальный стенд — работаем как есть */ });
      } catch (_) {}
    })();

    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (tg) { try { tg.ready(); tg.expand(); } catch (_) {} }

    // Supabase: чтение и запись идут только через Edge Function «stone-api».
    // Прямые RPC закрыты для anon — витрина отдаётся после проверки входа.
    const SUPABASE_URL = 'https://gjcqdesgbleaikjoemjb.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqY3FkZXNnYmxlYWlram9lbWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MTIxODEsImV4cCI6MjExMDk4ODE4MX0.IJun-Me4P1h2zN_K49865SQO0lEyDoWYhrPkMw456eI';

    // Edge Function «stone-api»: авторизация, витрина, запись, health
    const STONE_API_URL = SUPABASE_URL + '/functions/v1/stone-api';
    const STONE_API_HEADERS = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    };

    // Веб-сессия (беспарольный вход через бота)
    const SESSION_KEY = 'stone_session_v1';
    let sessionToken = '';
    try { sessionToken = localStorage.getItem(SESSION_KEY) || ''; } catch (_) {}

    const POSTS_LIST = [
      { num: 1,  name: 'КПП', shift: '08:00–20:00 / 20:00–08:00', zone: 'ground' },
      { num: 2,  name: 'Патруль', shift: '02:00–14:00 / 14:00–02:00', zone: 'ground' },
      { num: 3,  name: 'Секция 4', shift: '08:00–20:00', zone: 'ground' },
      { num: 4,  name: 'Подземный паркинг', shift: '12ч (Offline-First)', zone: 'underground' },
      { num: 5,  name: 'Секция 1', shift: '02:00–14:00 / 14:00–02:00', zone: 'ground' },
      { num: 6,  name: 'Секция 2', shift: '02:00–14:00 / 14:00–02:00', zone: 'ground' },
      { num: 7,  name: 'Секция 3', shift: '08:00–20:00', zone: 'ground' },
      { num: 8,  name: 'Центр. вход (галерея)', shift: '02:00–14:00 / 14:00–02:00', zone: 'ground' },
      { num: 9,  name: 'Пропуск рабочих', shift: '08:00–20:00', zone: 'ground' },
      { num: 10, name: 'Мониторная', shift: '08:00–20:00 / 20:00–08:00', zone: 'command' },
      { num: 11, name: 'Надземная парковка', shift: '08:00–20:00', zone: 'ground' },
      { num: 12, name: 'Выезд подзем. паркинга', shift: '08:00–20:00 (Offline)', zone: 'underground' }
    ];

    // Единый источник правды для списков постов: серверная витрина, а не локальный
    // fallback. В архиве посты тоже остаются видимыми в «Объектах и доступах».
    function allPosts() {
      return (state.postsAll && state.postsAll.length) ? state.postsAll : POSTS_LIST;
    }
    function activePosts() {
      return allPosts().filter((p) => p.isActive !== false);
    }

    // 35 реальных сотрудников из группы «Охрана СБ Стоун.» (36-й — Александр Николаевич, 100-й СБ, исключён из приложения)
    const state = {
      role: 'chief',
      activeTab: 'base',
      baseMode: 'compact',
      baseFilter: 'all',
      searchQuery: '',
      bookingMode: 'any',
      bookingStart: '', // заполняется ближайшим якорем цикла (13 или 28 число) в ensurePlan()
      bookingPriorities: [1, 8],
      bookingBusy: false, // true, пока заявка в полёте — блокирует кнопку и показывает прогресс
      myBooking: null,   // своя неотменённая заявка: бронировать можно только один раз
      // Озвучка вопросов теста: по умолчанию включена, выбор запоминается
      testVoice: (() => { try { return localStorage.getItem('stone_test_voice') !== '0'; } catch (_) { return true; } })(),
      reminderT7Added: false,
      reminderT5Status: 'pending',
      selectedMelody: 'clear_pulse',
      capturedPhotoUrl: '',
      // Очередь оффлайн-отметок: [{ post_number, at, method }]. Живёт в localStorage,
      // чтобы переживать перезагрузку страницы и закрытие Mini App.
      offlineQueue: [],
      guideTab: 'tour',
      guideStep: 0,
      // Матрица постов и годовой план (этапы 1–2)
      postsAll: [],
      planBlocks: [],
      planMonths: 0,
      planApproved: false,
      planApprovedAt: null,
      planDirty: false,
      postEditor: null,
      empEditor: null,
      // Конструктор (этап 4)
      config: null,
      configVersion: 0,
      configDraft: null,
      configDirty: false,
      // Аттестация и ИИ (этапы 5–6)
      attestation: null,
      attTab: 'modules',
      attReport: null,
      studyModule: null,
      studySession: null,
      studyTimerId: null,
      attempt: null,
      aiChat: [],
      aiBusy: false,
      selectedVideoId: 1,
      watchedVideos: { 1: true },
      videoFilter: 'all',
      bgTheme: 'dark',
      accentColor: 'blue',
      setupTab: 'posts',
      setupStatus: null,
      pinStatus: {},
      lastPin: null,
      showAllStaff: false,
      tgAuth: { status: 'pending' },
      cloudEmployeeId: null,
      // Демо-ростер удалён: список сотрудников и заявок приходит только из
      // get-base после проверки личности. Пустые массивы = честное «данных нет»,
      // а не выдуманные фамилии в публичном репозитории.
      staff: [],
      applicants: []
    };

    // -----------------------------------------------------------------------
    // Аудио, Календарь Т-5д и Хелперы
    // -----------------------------------------------------------------------
    let toastTimer = null;
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.remove('hidden');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
    }

    function setLiveBanner(msg) {
      document.getElementById('liveBannerText').textContent = msg;
    }

    function canCommand() {
      return ['chief', 'senior_20', 'senior_19_night', 'developer'].includes(state.role);
    }

    function roleLabel(r) {
      if (r === 'chief') return '«Рубеж»';
      if (r === 'senior_20') return '№20 День (08–20)';
      if (r === 'senior_19_night') return '№19 Ночь (20–08)';
      if (r === 'monitor_10') return '№10 Мониторная';
      if (r === 'developer') return 'Разработчик (Тех. админ)';
      return 'Охранник';
    }

    function statusIcon(status) {
      if (status === 'on_watch') return '<span title="На вахте" class="w-4 h-4 rounded-full bg-emerald-500 text-slate-950 font-bold text-[10px] inline-flex items-center justify-center shrink-0">✓</span>';
      if (status === 'approved') return '<span title="Утверждён на вахту" class="dot-approved"></span>';
      if (status === 'reserve_2w') return '<span title="Резерв: через 2 нед." class="w-3.5 h-3.5 rounded-full bg-yellow-400 inline-block shrink-0"></span>';
      if (status === 'reserve_1m') return '<span title="Резерв: до месяца" class="w-3.5 h-3.5 rounded-full bg-rose-500 inline-block shrink-0"></span>';
      return '<span title="Более месяца" class="w-3.5 h-3.5 rounded-full bg-slate-500 inline-block shrink-0"></span>';
    }

    function statusText(s) {
      if (s === 'on_watch') return 'На вахте';
      if (s === 'approved') return 'Утверждён';
      if (s === 'reserve_2w') return '2 нед.';
      if (s === 'reserve_1m') return 'До мес.';
      return '>1 мес.';
    }

    // Приоритет: загруженный сотрудником аватар (Supabase Storage) -> инициалы.
    // Встроенных снимков больше нет: 35 фотографий лежали прямо в этом файле,
    // а он публикуется на GitHub Pages без авторизации (находка N1).
    function avatarHtml(avKey, status, sizeCls = 'w-8 h-8', url = '') {
      const raw = String(url || '');
      // Ссылка на аватар приходит из базы: пускаем только http(s)/data:image,
      // иначе javascript: в src сработает по клику.
      const src = /^(https?:\/\/|data:image\/)/i.test(raw) ? raw : '';
      const ring = `avatar-ring-${status}`;
      if (src) {
        return `<img src="${escHtml(src)}" alt="" loading="lazy" class="${sizeCls} rounded-full object-cover ${ring} shrink-0 bg-slate-800" />`;
      }
      return `<div class="${sizeCls} rounded-full bg-slate-800 ${ring} shrink-0 flex items-center justify-center text-[10px] text-slate-300 font-semibold">СО</div>`;
    }

    let activeAudioCtx = null;
    function stopNotificationSound() {
      if (activeAudioCtx) {
        try { activeAudioCtx.close(); } catch (_) {}
        activeAudioCtx = null;
      }
    }

    function playFixedNotificationSound(melodyId) {
      stopNotificationSound();
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        activeAudioCtx = ctx;
        const now = ctx.currentTime;
        const playTone = (freq, start, dur, type = 'sine', vol = 0.22) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, now + start);
          gain.gain.setValueAtTime(0.001, now + start);
          gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + start);
          osc.stop(now + start + dur + 0.03);
        };
        // Длительность каждого сигнала — ровно ~6.5 секунд (минимум 6 сек)
        for (let rep = 0; rep < 5; rep++) {
          const offset = rep * 1.3;
          if (melodyId === 'clear_pulse') {
            playTone(880, offset + 0.0, 0.18, 'triangle', 0.22);
            playTone(1174.66, offset + 0.22, 0.24, 'triangle', 0.22);
            playTone(1318.51, offset + 0.50, 0.36, 'triangle', 0.20);
          } else if (melodyId === 'double_ring') {
            playTone(740, offset + 0.0, 0.16, 'sine', 0.24);
            playTone(740, offset + 0.22, 0.16, 'sine', 0.24);
            playTone(987.77, offset + 0.46, 0.40, 'sine', 0.22);
          } else if (melodyId === 'soft_chime') {
            playTone(523.25, offset + 0.0, 0.30, 'sine', 0.20);
            playTone(659.25, offset + 0.24, 0.32, 'sine', 0.20);
            playTone(783.99, offset + 0.50, 0.48, 'sine', 0.18);
          } else {
            playTone(660, offset + 0.0, 0.18, 'square', 0.14);
            playTone(880, offset + 0.22, 0.18, 'square', 0.14);
            playTone(660, offset + 0.44, 0.18, 'square', 0.14);
            playTone(990, offset + 0.66, 0.32, 'square', 0.14);
          }
        }
      } catch (_) {}
    }

    function getT5ReminderDates() {
      const base = new Date((state.bookingStart || '2026-12-01') + 'T09:00:00');
      const t5 = new Date(base.getTime() - 5 * 86400000);
      const pad = (n) => String(n).padStart(2, '0');
      const ymd = `${t5.getFullYear()}${pad(t5.getMonth() + 1)}${pad(t5.getDate())}`;
      const t5Human = `${pad(t5.getDate())}.${pad(t5.getMonth() + 1)}.${t5.getFullYear()}`;
      const arrivalHuman = `${pad(base.getDate())}.${pad(base.getMonth() + 1)}.${base.getFullYear()}`;
      return { ymd, t5Human, arrivalHuman };
    }

    function buildGoogleCalUrl() {
      const { ymd, arrivalHuman } = getT5ReminderDates();
      const title = encodeURIComponent(`Стоун Охрана: подтвердить приезд на вахту (заезд ${arrivalHuman})`);
      const details = encodeURIComponent(`До начала вахты (${arrivalHuman}) осталось 5 дней. Откройте Telegram-бот или веб-приложение «Стоун Охрана» и нажмите «Подтверждаю приезд на вахту».`);
      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${ymd}T090000/${ymd}T093000&details=${details}`;
    }

    function downloadCalendarIcs() {
      const { ymd, arrivalHuman } = getT5ReminderDates();
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stone Ohrana//WFM//RU', 'BEGIN:VEVENT',
        `DTSTART:${ymd}T090000`, `DTEND:${ymd}T093000`,
        `SUMMARY:Стоун Охрана: подтвердить приезд на вахту (заезд ${arrivalHuman})`,
        `DESCRIPTION:До начала вахты (${arrivalHuman}) осталось 5 дней. Откройте Telegram-бот или веб-приложение «Стоун Охрана» и нажмите «Подтверждаю приезд на вахту».`,
        'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Подтвердить выезд на вахту в «Стоун Охрана»', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'stone_ohrana_t5_reminder.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const TOUR_STEPS = [
      {
        title: '1. Зачем «Стоун Охрана» и как войти',
        goal: 'Цель: ноль пустых постов и никаких ночных обзвонов.',
        body: 'Система хранит единую базу всех 35 сотрудников и 11+ постов (смены 08:00–20:00 и 02:00–14:00). В Telegram вход автоматический по вашему ID, а в Chrome — через одноразовую кнопку в боте. Подменить чужую роль невозможно.'
      },
      {
        title: '2. Вкладка «База» и 5 цветов готовности',
        goal: 'За 2 секунды видно, кто на посту, а кто в резерве.',
        body: 'Переключатель «Компактный / Обычный» меняет плотность карточек. Зелёный с галочкой (✓) — на вахте; жёлтый в зелёном кружке (◎) — утверждён на выезд; жёлтый — выйдет через 2 недели; красный — до месяца; серый — пауза более месяца.'
      },
      {
        title: '3. Вкладка «Бронь»: резерв, отдых и план на годы',
        goal: 'Чем раньше планируете вахту — тем выше шанс попасть на любимый пост.',
        body: 'Укажите дату заезда и выберите «Вахта (любой пост)» либо расставьте приоритеты конкретных постов (1, 2, 3). Планирование на 3, 6 или 12+ месяцев даёт бонус приоритета в списке «Желающие».'
      },
      {
        title: '4. Напоминания Т-7д / Т-5д и «Чекин 150м»',
        goal: 'Никто не забудет подтвердить выезд, а прибытие фиксируется само.',
        body: 'За 7 дней нажмите «Google Календарь» — дата за 5 дней до вахты подставится сама. За 5 дней нажмите «Подтверждаю приезд». При прибытии в радиус 150 м от объекта статус «На вахте (✓)» включится автоматически (для паркинга №4 и №12 работает оффлайн-кэш).'
      },
      {
        title: '5. Вкладка «Желающие» (№20, №19, «Рубеж», Разработчик)',
        goal: 'Двухэтапное утверждение: сначала вахта, затем пост.',
        body: 'Командиры сначала утверждают сам заезд сотрудника (◎ · пост уточняется), а затем подтверждают желаемый или любой другой пост по обстановке. Постоянный костяк поста при полном штате всегда идёт первым.'
      }
    ];

    const VIDEO_PLAN = [
      { id: 1, dur: '15 сек · 9:16', audience: 'Для всех', title: 'Что такое «Стоун Охрана» и как войти за 10 секунд', desc: 'Цели системы, авто-вход в Telegram Mini App и безопасный вход в Google Chrome через кнопку бота.' },
      { id: 2, dur: '15 сек · 9:16', audience: 'Для всех', title: '«База»: 5 цветов готовности и Компактный/Обычный режим', desc: 'Как за 2 секунды оценить укомплектованность смен (08–20 и 02–14) и найти нужного человека.' },
      { id: 3, dur: '15 сек · 9:16', audience: 'Охранники', title: 'Резерв, фиксация отдыха и долгосрочная бронь на годы', desc: 'Как поставить статус отдыха, выбрать «Вахту» или приоритеты постов и получить бонус за ранний план.' },
      { id: 4, dur: '15 сек · 9:16', audience: 'Охранники', title: 'Календарь Т-7д, подтверждение Т-5д и авто-чекин 150м', desc: 'Добавление напоминания в Google Календарь, фиксированная мелодия, фото-предпросмотр и кэш в паркинге №4/№12.' },
      { id: 5, dur: '15 сек · 9:16', audience: '№20 · №19 · Рубеж', title: 'Кабинет командира: Желающие, 2-этапное утверждение и посты', desc: 'Как утверждать вахту отдельно от поста, переназначать пост по ситуации и добавлять новые посты.' }
    ];

    // Рабочие вкладки очищены от баннеров-подсказок (этап 5): остались только
    // пояснения внутри вкладки «Обучение / Гид».
    const ZONE_LABELS = {
      street: 'улица', lobby: 'лобби', parking: 'паркинг', monitor: 'мониторная',
      unloading: 'разгрузка', ground: 'улица', underground: 'паркинг', command: 'командный'
    };
    function zoneLabel(z) { return ZONE_LABELS[z] || z || '—'; }

    // «08:00-20:00 / 20:00-08:00» -> «08–20»
    function shiftShort(s) {
      const m = String(s || '').match(/(\d{2}):00/);
      if (!m) return '12ч';
      const from = Number(m[1]);
      return `${String(from).padStart(2, '0')}–${String((from + 12) % 24).padStart(2, '0')}`;
    }

    function fmtMinutes(sec) {
      const s = Math.max(0, Number(sec) || 0);
      if (s < 60) return `${s} с`;
      const m = Math.round(s / 60);
      if (m < 60) return `${m} мин`;
      return `${Math.floor(m / 60)} ч ${m % 60} мин`;
    }

    // Экранирование любого значения, пришедшего из базы или от пользователя,
    // перед вставкой в innerHTML. Без него имя сотрудника с «<img onerror=…>»
    // исполнится в браузере командира.
    function escHtml(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Минимальный markdown -> HTML для конспектов модулей (без внешних библиотек)
    function mdToHtml(md) {
      const esc = escHtml;
      const lines = String(md || '').split(/\r?\n/);
      let html = '';
      let inList = false;
      const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) { closeList(); continue; }
        if (/^###\s+/.test(line)) { closeList(); html += `<h3>${esc(line.replace(/^###\s+/, ''))}</h3>`; continue; }
        if (/^##\s+/.test(line)) { closeList(); html += `<h3>${esc(line.replace(/^##\s+/, ''))}</h3>`; continue; }
        if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${esc(line.replace(/^>\s?/, ''))}</blockquote>`; continue; }
        if (/^[*\-]\s+/.test(line)) {
          if (!inList) { html += '<ul class="space-y-0.5">'; inList = true; }
          html += `<li>${inlineMd(esc(line.replace(/^[*\-]\s+/, '')))}</li>`;
          continue;
        }
        closeList();
        html += `<p>${inlineMd(esc(line))}</p>`;
      }
      closeList();
      return html;
    }
    function inlineMd(s) {
      return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code class="text-blue-300">$1</code>');
    }

    function renderGuideModal() {
      const body = document.getElementById('guideModalBody');
      const footer = document.getElementById('guideModalFooter');
      document.querySelectorAll('.gtab-btn').forEach(b => {
        b.className = `gtab-btn flex-1 py-1.5 rounded-xl text-xs font-medium transition ${b.dataset.gtab === state.guideTab ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-300'}`;
      });

      if (state.guideTab === 'tour') {
        const s = TOUR_STEPS[state.guideStep];
        body.innerHTML = `
          <div class="flex items-center gap-1 mb-1">
            ${TOUR_STEPS.map((_, i) => `<div class="h-1 flex-1 rounded-full ${i <= state.guideStep ? 'bg-blue-500' : 'bg-slate-800'}"></div>`).join('')}
          </div>
          <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div class="text-sm font-semibold text-white">${s.title}</div>
            <div class="text-[11px] font-medium text-emerald-400">${s.goal}</div>
            <p class="text-xs text-slate-300 leading-relaxed">${s.body}</p>
          </div>
        `;
        footer.innerHTML = `
          <button type="button" id="guidePrevBtn" class="px-3 py-1.5 rounded-xl bg-slate-800 text-xs text-slate-200 ${state.guideStep === 0 ? 'opacity-40' : ''}">← Назад</button>
          <span class="text-[11px] text-slate-400">Шаг ${state.guideStep + 1} из ${TOUR_STEPS.length}</span>
          <button type="button" id="guideNextBtn" class="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white">
            ${state.guideStep === TOUR_STEPS.length - 1 ? 'Завершить ✓' : 'Далее →'}
          </button>
        `;
      } else {
        body.innerHTML = `
          <p class="text-[11px] text-slate-400">Короткие вертикальные ролики (9:16), встроенные прямо в бота и приложение для быстрого старта новых сотрудников:</p>
          <div class="space-y-2">
            ${VIDEO_PLAN.map(v => `
              <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold text-white">${v.id}. ${v.title}</span>
                  <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-blue-300 shrink-0">${v.dur}</span>
                </div>
                <div class="text-[10px] text-emerald-400">Аудитория: ${v.audience}</div>
                <p class="text-[11px] text-slate-400 leading-relaxed">${v.desc}</p>
              </div>
            `).join('')}
          </div>
        `;
        footer.innerHTML = `
          <button type="button" id="guideDoneBtn" class="px-3.5 py-1.5 rounded-xl bg-blue-600 text-xs font-semibold text-white">Понятно</button>
        `;
      }
    }

    // -----------------------------------------------------------------------
    // Вкладка 1: База (Компактный + Обычный, 35 реальных сотрудников с аватарами)
    // -----------------------------------------------------------------------
    function renderBaseTab() {
      const onWatch = state.staff.filter(s => s.status === 'on_watch').length;
      const approved = state.staff.filter(s => s.status === 'approved').length;
      const reserve = state.staff.filter(s => s.status.startsWith('reserve')).length;
      // N14: напоминания Т-7/Т-5 физически не доходят до сотрудников без Telegram.
      // Считаем только там, где tgLinked вообще приходит (командиры).
      const unlinkedTg = state.staff.filter(s => s.tgLinked === false).length;
      const q = state.searchQuery.trim().toLowerCase();

      const filtered = state.staff.filter(s => {
        if (state.baseFilter === 'on_watch' && s.status !== 'on_watch') return false;
        if (state.baseFilter === 'approved' && s.status !== 'approved') return false;
        if (state.baseFilter === 'reserve' && !s.status.startsWith('reserve')) return false;
        if (q && !s.name.toLowerCase().includes(q) && !s.post.toLowerCase().includes(q)) return false;
        return true;
      });


      return `
        <div class="space-y-3.5 min-w-0">
          <!-- KPI-сводка (2x2 на телефоне, 4 в ряд на ПК — без сжатия текста) -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="pro-card rounded-xl p-3 text-center min-w-0">
              <div class="text-[10px] text-slate-400 truncate">В системе</div>
              <div class="text-base sm:text-xl font-bold text-white tabular-nums">${state.staff.length}</div>
            </div>
            <div class="pro-card border-emerald-500/30 rounded-xl p-3 text-center min-w-0">
              <div class="text-[10px] text-emerald-300 truncate">На вахте ✓</div>
              <div class="text-base sm:text-xl font-bold text-emerald-400 tabular-nums">${onWatch}</div>
            </div>
            <div class="pro-card border-yellow-400/30 rounded-xl p-3 text-center min-w-0">
              <div class="text-[10px] text-yellow-200 truncate">Утв. ◎</div>
              <div class="text-base sm:text-xl font-bold text-yellow-300 tabular-nums">${approved}</div>
            </div>
            <div class="pro-card rounded-xl p-3 text-center min-w-0">
              <div class="text-[10px] text-slate-400 truncate">Резерв</div>
              <div class="text-base sm:text-xl font-bold text-blue-400 tabular-nums">${reserve}</div>
            </div>
          </div>

          ${canCommand() && unlinkedTg ? `
            <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-2">
              <span class="text-[10.5px] text-amber-200 min-w-0">
                Напоминания Т-7 и Т-5 не дойдут: <b class="tabular-nums">${unlinkedTg}</b> из ${state.staff.length} без Telegram.
              </span>
              <button type="button" data-action="open-setup-staff" class="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] text-amber-100 shrink-0">Привязать</button>
            </div>` : ''}

          <!-- Панель режимов и фильтров (адаптивная, кнопки никогда не наезжают) -->
          <div class="pro-card rounded-2xl p-3.5 space-y-3">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div class="grid grid-cols-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800 w-full sm:w-64 shrink-0">
                <button type="button" data-action="set-base-mode" data-val="compact" class="px-3 py-2 rounded-lg text-xs font-semibold text-center whitespace-nowrap transition ${state.baseMode === 'compact' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}">Компактный</button>
                <button type="button" data-action="set-base-mode" data-val="expanded" class="px-3 py-2 rounded-lg text-xs font-semibold text-center whitespace-nowrap transition ${state.baseMode === 'expanded' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}">Обычный</button>
              </div>
              <input id="staffSearchInput" type="search" value="${escHtml(state.searchQuery)}" placeholder="Поиск по имени или посту..." class="w-full sm:flex-1 sm:max-w-xs bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500/60" />
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button type="button" data-action="set-base-filter" data-val="all" class="py-1.5 px-1 rounded-lg text-[11px] font-medium truncate transition ${state.baseFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'}">Все (${state.staff.length})</button>
              <button type="button" data-action="set-base-filter" data-val="on_watch" class="py-1.5 px-1 rounded-lg text-[11px] font-medium truncate transition ${state.baseFilter === 'on_watch' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30' : 'bg-slate-900 text-slate-400'}">Посты (${onWatch})</button>
              <button type="button" data-action="set-base-filter" data-val="approved" class="py-1.5 px-1 rounded-lg text-[11px] font-medium truncate transition ${state.baseFilter === 'approved' ? 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/30' : 'bg-slate-900 text-slate-400'}">Утв. (${approved})</button>
              <button type="button" data-action="set-base-filter" data-val="reserve" class="py-1.5 px-1 rounded-lg text-[11px] font-medium truncate transition ${state.baseFilter === 'reserve' ? 'bg-blue-600/25 text-blue-300 border border-blue-500/30' : 'bg-slate-900 text-slate-400'}">Резерв (${reserve})</button>
            </div>
          </div>

          <!-- Легенда 5 статусов -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-400">
            <span class="inline-flex items-center gap-1">${statusIcon('on_watch')} На вахте</span>
            <span class="inline-flex items-center gap-1">${statusIcon('approved')} Утверждён</span>
            <span class="inline-flex items-center gap-1">${statusIcon('reserve_2w')} 2 нед.</span>
            <span class="inline-flex items-center gap-1">${statusIcon('reserve_1m')} До мес.</span>
            <span class="inline-flex items-center gap-1">${statusIcon('reserve_long')} &gt;1 мес.</span>
          </div>

          <!-- Список сотрудников -->
          ${state.baseMode === 'compact' ? `
            <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
              ${filtered.map(s => `
                <div class="bg-[#111827] border ${s.status === 'approved' && !s.postConfirmed ? 'border-yellow-400/40' : 'border-slate-800/90'} rounded-xl p-2 flex items-center gap-2 min-w-0 hover:border-slate-700 transition">
                  ${avatarHtml(s.av, s.status, 'w-8 h-8', s.avatarUrl)}
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-1">
                      <span class="text-[11px] font-semibold text-white truncate">${escHtml(s.name)}</span>
                      ${statusIcon(s.status)}
                    </div>
                    <div class="text-[10px] ${s.post === 'Уточняется' ? 'text-yellow-300' : 'text-slate-400'} truncate">${escHtml(s.post)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              ${filtered.map(s => `
                <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-3.5 space-y-2.5 min-w-0">
                  <div class="flex items-start gap-3 min-w-0">
                    ${avatarHtml(s.av, s.status, 'w-11 h-11', s.avatarUrl)}
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm font-semibold text-white truncate">${escHtml(s.name)}</span>
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700/80 text-[10px] text-slate-200 shrink-0">
                          ${statusIcon(s.status)} ${statusText(s.status)}
                        </span>
                      </div>
                      <div class="text-xs text-slate-300 mt-0.5 truncate">
                        <span class="${s.post === 'Уточняется' ? 'text-yellow-300 font-medium' : 'text-slate-200'}">${escHtml(s.post)}</span>
                        <span class="text-slate-500"> · </span>
                        <span class="text-blue-300 tabular-nums">${escHtml(s.shift)}</span>
                      </div>
                    </div>
                  </div>
                  <div class="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 flex items-center justify-between gap-2 min-w-0">
                    <span class="truncate">${escHtml(s.note)}</span>
                    <span class="text-slate-300 shrink-0 tabular-nums">${escHtml(s.day)}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2 min-w-0">
                    <div class="flex flex-wrap items-center gap-1 text-[10px] min-w-0">
                      <span class="${s.attestationOk ? 'px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'text-slate-500'}" title="${s.attestationOk ? 'Аттестация сдана на нужный балл' : 'Материал по работе — во вкладке «Обучение»'}${(s.missingModules || []).length ? ': ' + (s.missingModules || []).map(m => escHtml(m.title)).join(', ') : ''}">${s.attestationOk ? '✓ аттестация' : 'материал к изучению'}</span>
                      ${s.planMonths ? `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">план ${s.planMonths} мес.</span>` : ''}
                      ${s.discipline ? `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">дисц. ${s.discipline > 0 ? '+' : ''}${s.discipline}</span>` : ''}
                      ${s.core ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">костяк</span>' : ''}
                    </div>
                    ${canCommand() ? `
                      <button type="button" data-action="edit-employee" data-id="${s.id}" class="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-blue-300 shrink-0">
                        ✎ Редактировать
                      </button>
                      <button type="button" data-action="approve-plan-for" data-id="${s.id}" title="Согласовать годовой план сотрудника" class="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300 shrink-0">
                        ✓ План
                      </button>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // Вкладка 2: Бронь — годовой планировщик 15-дневных блоков (этап 2)
    // -----------------------------------------------------------------------
    function isoOf(d) { return d.toISOString().slice(0, 10); }
    function todayIso() { return new Date().toISOString().slice(0, 10); }
    // Локальная дата без сдвига часового пояса (toISOString в UTC для МСК даёт −1 день).
    function isoLocal(d) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    // --- Циклы вахты: заступление 13-го и 28-го числа -----------------------
    // В месяце два цикла: 13 → 27 и 28 → 12 следующего месяца. Конец блока
    // считается от СЛЕДУЮЩЕГО якоря (а не «+14 дней»), поэтому февраль и любой
    // другой месяц не ломают сетку. Время заступления и сдачи поста — всегда
    // 08:00, независимо от графика поста: даже на смене 02:00–14:00 заступление
    // и передача поста происходят в 08:00.
    const CYCLE_ANCHORS = [13, 28];
    const HANDOVER_TIME = '08:00';

    function anchorOnOrAfter(iso) {
      const d = new Date((iso || todayIso()) + 'T00:00:00');
      if (isNaN(d.getTime())) return todayIso();
      const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
      if (day <= 13) return isoLocal(new Date(y, m, 13));
      if (day <= 28) return isoLocal(new Date(y, m, 28));
      return isoLocal(new Date(y, m + 1, 13));
    }

    function nextAnchor(iso) {
      const d = new Date(iso + 'T00:00:00');
      const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
      return day === 13 ? isoLocal(new Date(y, m, 28)) : isoLocal(new Date(y, m + 1, 13));
    }

    function addDaysToIso(iso, n) {
      const d = new Date(iso + 'T00:00:00');
      d.setDate(d.getDate() + n);
      return isoLocal(d);
    }

    // Стартов на один больше, чем блоков: последний нужен для конца последнего блока.
    function planCycleStarts(count) {
      const out = [];
      let cur = anchorOnOrAfter(state.bookingStart || todayIso());
      for (let i = 0; i <= count; i++) { out.push(cur); cur = nextAnchor(cur); }
      return out;
    }

    function planBlockDates(i, starts) {
      const s = starts || planCycleStarts(24);
      const start = s[i] || anchorOnOrAfter(state.bookingStart || todayIso());
      const end = addDaysToIso(s[i + 1] || nextAnchor(start), -1);
      return { start, end };
    }

    function buildPlanPattern(blocks, pattern) {
      const starts = planCycleStarts(blocks);
      const out = [];
      const workRun = pattern === 'work2' ? 4 : pattern === 'work3' ? 6 : 0;
      for (let i = 0; i < blocks; i++) {
        let type;
        if (workRun) type = i < workRun ? 'work' : ((i - workRun) % 2 === 0 ? 'rest' : 'work');
        else type = i % 2 === 0 ? 'work' : 'rest';
        out.push({ start: starts[i], end: addDaysToIso(starts[i + 1], -1), type, manual: false });
      }
      return out;
    }

    function ensurePlan() {
      if (!state.bookingStart) state.bookingStart = anchorOnOrAfter(todayIso());
      if (state.planInit) return;
      state.planInit = true;
      if (!Array.isArray(state.planBlocks) || !state.planBlocks.length) {
        state.planBlocks = buildPlanPattern(12, 'alt');
      }
    }

    function planWorkDays(blocks) {
      return (blocks || []).filter(b => b.type === 'work').reduce((s, b) => {
        const d = Math.round((new Date(b.end + 'T00:00:00') - new Date(b.start + 'T00:00:00')) / 86400000) + 1;
        return s + (d > 0 ? d : 0);
      }, 0);
    }

    // Глубина плана считается только по рабочим блокам: один «отдых» на год
    // больше не даёт максимум (N4). Совпадение с серверным plan_depth_months.
    function planMonthsFrom(blocks) {
      if (!Array.isArray(blocks) || !blocks.length) return 0;
      const work = blocks.filter(b => b && b.type !== 'rest');
      if (!work.length) return 0;
      const maxEnd = work.reduce((m, b) => (b.end > m ? b.end : m), '');
      if (!maxEnd) return 0;
      const days = Math.max(0, Math.round((new Date(maxEnd + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 86400000));
      return Math.min(12, Math.floor(days / 30));
    }
    function planBonusOf(months) { return months >= 12 ? 50 : months >= 6 ? 35 : months >= 3 ? 20 : 0; }

    function planHorizonCode(months) {
      if (months >= 12) return '1y';
      if (months >= 6) return '6m';
      if (months >= 3) return '3m';
      return '1m';
    }

    function renderBookingTab() {
      ensurePlan();
      const months = planMonthsFrom(state.planBlocks);
      // Бонус за горизонт плана начисляется только после согласования командиром (N4).
      const bonus = state.planApproved ? planBonusOf(months) : 0;
      const workDays = planWorkDays(state.planBlocks);
      const cycleStart = anchorOnOrAfter(state.bookingStart || todayIso());
      const cycleEnd = addDaysToIso(nextAnchor(cycleStart), -1);

      return `
        <div class="max-w-xl mx-auto space-y-3.5 min-w-0">
          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3.5 card-clip">
            <div>
              <h2 class="text-sm font-semibold text-white">Годовой план вахты · циклы 13 и 28 числа</h2>
              <p class="text-xs text-slate-400 mt-0.5">В месяце два цикла: <b class="text-slate-300">13 → 27</b> и <b class="text-slate-300">28 → 12</b> следующего месяца. Клик по блоку переключает «Работа ↔ Отдых».</p>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-start gap-2">
              <span class="text-[13px] leading-none mt-0.5">🕗</span>
              <p class="text-[10.5px] text-slate-400 leading-relaxed min-w-0">
                Заступление и сдача поста — <b class="text-slate-200">всегда ${HANDOVER_TIME}</b>, независимо от графика поста.
                Даже на смене 02:00–14:00 заступление в ${HANDOVER_TIME}, передача поста следующей смене тоже в ${HANDOVER_TIME}.
              </p>
            </div>

            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Заступление (13 или 28 число)</label>
              <input type="date" id="bookingDateInput" value="${state.bookingStart}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white outline-none" />
              <p class="text-[10px] text-slate-500 mt-1 tabular-nums">Ближайший цикл: ${cycleStart.slice(8, 10)}.${cycleStart.slice(5, 7)} ${HANDOVER_TIME} → ${cycleEnd.slice(8, 10)}.${cycleEnd.slice(5, 7)} ${HANDOVER_TIME}</p>
            </div>

            <div class="space-y-1.5">
              <div class="text-[11px] text-slate-400">Быстрые пресеты</div>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                <button type="button" data-action="plan-preset" data-val="3m" class="px-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200">Цикл 13/28 · 3 мес.</button>
                <button type="button" data-action="plan-preset" data-val="6m" class="px-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200">Цикл 13/28 · 6 мес.</button>
                <button type="button" data-action="plan-preset" data-val="12m" class="px-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200">Цикл 13/28 · 12 мес.</button>
                <button type="button" data-action="plan-preset" data-val="work2" class="px-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200">2 месяца подряд</button>
                <button type="button" data-action="plan-preset" data-val="work3" class="px-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200">3 месяца подряд</button>
                <button type="button" data-action="plan-preset" data-val="clear" class="px-2 py-2 rounded-xl bg-slate-900 hover:bg-rose-600/20 border border-slate-800 text-[11px] text-slate-300">Очистить</button>
              </div>
            </div>

            <div class="plan-grid">
              ${state.planBlocks.map((b, i) => {
                const dd = b.start.slice(8, 10) + '.' + b.start.slice(5, 7);
                const de = b.end.slice(8, 10) + '.' + b.end.slice(5, 7);
                const cls = b.type === 'work' ? 'plan-work' : 'plan-rest';
                const manual = b.manual ? ' plan-manual' : '';
                return `<button type="button" data-action="plan-toggle" data-idx="${i}" title="Заступление ${dd} ${HANDOVER_TIME} → сдача ${de} ${HANDOVER_TIME}" class="plan-cell ${cls}${manual}">
                  <span class="block font-semibold tabular-nums">${dd}</span>
                  <span class="block">${b.type === 'work' ? 'раб' : 'отд'}</span>
                </button>`;
              }).join('')}
            </div>

            <div class="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded plan-work"></span> работа</span>
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded plan-rest"></span> отдых</span>
              <span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded plan-rest plan-manual"></span> ручная правка</span>
            </div>

            <div class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-between gap-2 text-xs">
              <span class="text-blue-200 min-w-0">Запланировано <b class="tabular-nums">${months} мес.</b> · ${workDays} дн. работы</span>
              <span class="font-semibold ${state.planApproved ? 'text-blue-300' : 'text-slate-400'} shrink-0">${bonus ? '+' + bonus + ' баллов' : 'без бонуса'}</span>
            </div>
            ${state.planApproved ? `
              <div class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2 text-[11px] text-emerald-200">
                <span class="leading-none mt-0.5">✓</span>
                <span class="min-w-0">План согласован командиром${state.planApprovedAt ? ' ' + String(state.planApprovedAt).slice(0, 10).split('-').reverse().join('.') : ''} — бонус к приоритету начислен.</span>
              </div>
            ` : `
              <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-[11px] text-amber-200">
                <span class="min-w-0">План не согласован: бонус к приоритету не начисляется.</span>
                ${canCommand() ? `<button type="button" data-action="approve-plan" class="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] text-amber-100 shrink-0">Согласовать</button>` : ''}
              </div>
            `}
            <p class="text-[10px] text-slate-500 leading-relaxed">
              Бонус к приоритету выбора поста: 3–5 мес. +20, 6–11 мес. +35, 12 мес. +50 — только после согласования плана командиром. Костяк дополнительно +100, дисциплина −60…+30.
            </p>

            ${state.myBooking ? `
              <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
                <div class="text-[11px] font-semibold text-emerald-300">✓ Заявка уже отправлена</div>
                <p class="text-[10px] text-emerald-200/80 leading-relaxed">
                  ${state.myBooking.desired_start_date || state.myBooking.desired_start || '—'} — ${state.myBooking.desired_end_date || state.myBooking.desired_end || '—'}
                  · статус: ${bookingStatusLabel(state.myBooking.booking_status || state.myBooking.status)}.
                  Бронировать второй раз нельзя — план можно продолжать сохранять.
                </p>
                ${state.myBooking.booking_status === 'open' || state.myBooking.status === 'open' ? `
                  <button type="button" data-action="cancel-booking" data-id="${state.myBooking.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white">
                    Отменить заявку и забронировать заново
                  </button>` : ''}
              </div>
            ` : ''}

            ${state.bookingBusy ? `
              <div class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-2">
                <div class="flex items-center gap-2 text-xs font-medium text-blue-200">
                  <span class="spinner"></span><span>Отправляю заявку…</span>
                </div>
                <div class="busy-bar h-1 rounded-full bg-blue-500/20"></div>
                <p class="text-[10px] text-blue-200/70">Сохраняю план вахты и бронь в Supabase. Обычно 3–6 секунд — не закрывайте экран.</p>
              </div>
            ` : ''}

            <div class="flex gap-2">
              <button type="button" data-action="save-plan" ${state.bookingBusy ? 'disabled' : ''} class="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed">
                Сохранить план
              </button>
              <button type="button" data-action="submit-booking" ${state.bookingBusy || state.myBooking ? 'disabled' : ''} class="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5">
                ${state.bookingBusy ? '<span class="spinner"></span>Отправляю…' : state.myBooking ? 'Заявка уже есть' : 'Отправить заявку'}
              </button>
            </div>
          </div>

          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3.5 card-clip">
            <div>
              <h2 class="text-sm font-semibold text-white">Выбор поста</h2>
              <p class="text-xs text-slate-400 mt-0.5">Финальный пост утверждают №20, №19 или «Рубеж». Материал по посту — во вкладке «Обучение».</p>
            </div>
            <div class="min-w-0">
              <label class="block text-xs text-slate-400 mb-1">Режим</label>
              <select id="bookingModeSelect" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none">
                <option value="any" ${state.bookingMode === 'any' ? 'selected' : ''}>Вахта (любой доступный пост)</option>
                <option value="priorities" ${state.bookingMode === 'priorities' ? 'selected' : ''}>Указать приоритетные посты (1, 2, 3...)</option>
              </select>
            </div>

            ${state.bookingMode === 'priorities' ? `
              <div class="space-y-2">
                <div class="text-xs text-slate-400">Отметьте желаемые посты (порядок клика = приоритет):</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  ${activePosts().map(p => {
                    const idx = state.bookingPriorities.indexOf(p.num);
                    const selected = idx !== -1;
                    return `
                      <button type="button" data-action="toggle-prio-post" data-num="${p.num}" class="px-2.5 py-2 rounded-xl text-[11px] font-medium border text-left transition flex items-center justify-between gap-1 min-w-0 ${selected ? 'bg-blue-600/20 border-blue-500 text-blue-200' : 'bg-slate-900 border-slate-800 text-slate-300'}">
                        <span class="truncate">${selected ? `<span class="text-emerald-300 font-bold">✓</span> ${idx + 1}) ` : ''}№${p.num} ${escHtml(p.name)}</span>
                        <span class="text-[10px] ${selected ? 'text-emerald-300/80' : 'text-slate-400'} shrink-0">${shiftShort(p.shift)}</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            ${bookingFixSummary()}
          </div>
        </div>
      `;
    }

    // Подтверждение, что выбранные посты действительно попали в заявку
    function bookingFixSummary() {
      const nums = state.bookingPriorities.slice();
      const rows = nums.map((n, i) => {
        const p = POSTS_LIST.find(x => x.num === n);
        // Название поста вводит командир (2…60 любых символов) — без escHtml
        // это была stored XSS в сводке заявки (находка M6 четвёртого аудита).
        return `${i + 1}) №${n}${p ? ' ' + escHtml(p.name) : ''}`;
      });
      const isAny = state.bookingMode === 'any' || !rows.length;
      const word = rows.length === 1 ? 'пост' : rows.length < 5 ? 'поста' : 'постов';
      const text = isAny
        ? (state.bookingMode === 'any'
            ? 'Зафиксировано: <b>вахта</b> — любой доступный пост, без приоритетов.'
            : 'Посты пока не выбраны — заявка уйдёт как «вахта (любой доступный пост)».')
        : `Зафиксировано в заявке: <b>${rows.length}</b> ${word} — ${rows.join(', ')}`;
      return `
        <div class="p-2.5 rounded-xl border flex items-start gap-2 min-w-0 ${isAny ? 'bg-slate-900/70 border-slate-800' : 'bg-emerald-500/10 border-emerald-500/30'}">
          <span class="text-[12px] leading-none mt-0.5 shrink-0 ${isAny ? 'text-slate-500' : 'text-emerald-300'}">${isAny ? '•' : '✓'}</span>
          <div class="min-w-0 text-[11px] leading-relaxed ${isAny ? 'text-slate-400' : 'text-emerald-200'}">${text}</div>
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // Вкладка 3: Желающие (скоринг) + Матрица постов (этапы 1–2)
    // -----------------------------------------------------------------------
    function renderPostsMatrix() {
      const allowed = canCommand();
      const all = (state.postsAll && state.postsAll.length)
        ? state.postsAll
        : POSTS_LIST.map(p => Object.assign({}, p, { isActive: true }));
      const active = all.filter(p => p.isActive !== false);
      const archived = all.filter(p => p.isActive === false);

      const row = (p) => {
        const isOffline = Boolean(p.offline);
        const crew = p.crew || (state.staff.find(s => s.currentPostNumber === p.num) || {}).name || '';
        return `
          <div class="rounded-xl border ${p.isActive === false ? 'border-slate-800 bg-slate-950/60 opacity-70' : 'border-slate-700/80 bg-slate-900/60'} p-2.5 space-y-1.5 min-w-0">
            <div class="flex items-start justify-between gap-2 min-w-0">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold text-white truncate">№${p.num} ${escHtml(p.name)}</div>
                <div class="text-[10px] text-slate-400 truncate">
                  ${shiftShort(p.shift)} · ${zoneLabel(p.zone)}${isOffline ? ' · offline-first' : ''}
                </div>
              </div>
              ${allowed ? `
                <div class="flex items-center gap-1 shrink-0">
                  <button type="button" data-action="edit-post" data-num="${p.num}" title="Редактировать" class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200">✎</button>
                  <button type="button" data-action="toggle-post" data-num="${p.num}" title="${p.isActive === false ? 'Вернуть в работу' : 'Архивировать'}" class="w-6 h-6 rounded-lg ${p.isActive === false ? 'bg-emerald-600/25 text-emerald-300' : 'bg-slate-800 hover:bg-rose-600/30 text-slate-300'} text-[10px]">${p.isActive === false ? '↺' : '⏻'}</button>
                  ${[19, 20].includes(Number(p.num)) ? '' : `<button type="button" data-action="delete-post" data-num="${p.num}" title="Удалить полностью (нужен ПИН конструктора)" class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-red-600/40 text-[10px] text-slate-400 hover:text-white">🗑</button>`}
                </div>` : ''}
            </div>
            <div class="flex items-center justify-between gap-2 text-[10px]">
              <span class="text-slate-400 truncate">Дежурный: <span class="text-slate-200">${crew || '—'}</span></span>
              <span class="shrink-0 ${p.isActive === false ? 'text-slate-500' : 'text-emerald-400'}">${p.isActive === false ? 'архив' : 'активен'}</span>
            </div>
          </div>`;
      };

      return `
        <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3 min-w-0">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-white">Матрица постов</h2>
              <p class="text-xs text-slate-400">Активных: ${active.length} · в архиве: ${archived.length} · №19 и №20 системные</p>
            </div>
            ${allowed ? `
              <button type="button" data-action="new-post" class="w-full sm:w-auto px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shrink-0">
                + Создать пост
              </button>` : `<span class="text-[11px] text-amber-300">Просмотр (права у №20, №19, «Рубежа» и Разработчика)</span>`}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            ${active.map(row).join('')}
          </div>
          ${archived.length ? `
            <details class="pt-1">
              <summary class="text-[11px] text-slate-400 cursor-pointer">Архив (${archived.length})</summary>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1.5">${archived.map(row).join('')}</div>
            </details>` : ''}
        </div>
      `;
    }

    function scoreChips(a) {
      const b = a.scoreBreakdown || {};
      const parts = [];
      if (Number(b.core)) parts.push(`Костяк +${b.core}`);
      if (Number(b.plan)) parts.push(`План ${b.plan_months || 0} мес. +${b.plan}`);
      if (Number(b.discipline)) parts.push(`Дисциплина ${b.discipline > 0 ? '+' : ''}${b.discipline}`);
      if (Number(b.attestation)) parts.push(`Допуск +${b.attestation}`);
      return parts;
    }

    function renderApplicantsTab() {
      const allowed = canCommand();
      const list = state.applicants.slice().sort((x, y) => {
        const ax = x.attestationOk === false ? 1 : 0;
        const ay = y.attestationOk === false ? 1 : 0;
        if (ax !== ay) return ax - ay;
        return Number(y.score || 0) - Number(x.score || 0);
      });

      return `
        <div class="space-y-3.5 min-w-0">
          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 min-w-0">
            <h2 class="text-sm font-semibold text-white">Желающие на вахту · 2-этапное утверждение</h2>
            <p class="text-xs text-slate-400">Шаг 1 — утвердить выход (◎). Шаг 2 — подтвердить пост. Сортировка: сданная аттестация выше, затем балл приоритета.</p>
          </div>

          <div class="space-y-2.5">
            ${list.length ? list.map(a => {
              const chips = scoreChips(a);
              const missing = (a.missingModules || []).map(m => escHtml(m.title)).join(', ');
              return `
                <div class="bg-[#111827] border ${a.shiftApproved && !a.confirmedPost ? 'border-yellow-400/40' : 'border-slate-800/90'} rounded-2xl p-4 space-y-3 min-w-0">
                  <div class="flex items-start gap-3 min-w-0">
                    ${avatarHtml(a.av, a.shiftApproved ? 'approved' : a.status, 'w-10 h-10', a.avatarUrl)}
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-sm font-semibold text-white truncate">${escHtml(a.name)}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-200 border border-blue-500/30 tabular-nums">★ ${a.score != null ? a.score : '—'}</span>
                        ${a.core ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Костяк</span>' : ''}
                        ${a.attestationOk === true
                          ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title="Аттестация сдана на нужный балл">✓ аттестация</span>'
                          : a.attestationOk === false
                            ? `<span class="text-[10px] text-slate-500" title="Материал по работе доступен во вкладке «Обучение»${missing ? ': ' + missing : ''}">материал к изучению</span>`
                            : ''}
                      </div>
                      <div class="text-[11px] text-blue-300 mt-0.5">Горизонт: ${a.horizon}</div>
                      ${chips.length ? `<div class="text-[10px] text-slate-400 mt-0.5">${chips.join(' · ')}</div>` : ''}
                      <div class="flex flex-wrap gap-1 mt-2">
                        ${(a.priorities || []).map((pr, i) => `<span class="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-200">${a.mode === 'priorities' ? `${i + 1}) ` : ''}${escHtml(pr)}</span>`).join('')}
                      </div>
                    </div>
                  </div>

                  ${allowed ? `
                    <div class="pt-2.5 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center gap-2">
                      ${!a.shiftApproved ? `
                        <button type="button" data-action="approve-shift" data-id="${a.id}" class="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition">
                          1. Утвердить на вахту (◎)
                        </button>
                        <span class="text-[11px] text-slate-400">Пост можно подтвердить позже</span>
                      ` : `
                        <select data-assign-select="${a.id}" class="w-full sm:flex-1 bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 outline-none min-w-0">
                          ${activePosts().map(p => `<option value="№${p.num} ${escHtml(p.name)}" data-num="${p.num}">Пост: №${p.num} ${escHtml(p.name)}</option>`).join('')}
                        </select>
                        <button type="button" data-action="confirm-post" data-id="${a.id}" class="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition shrink-0">
                          2. Подтвердить пост
                        </button>
                      `}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('') : `
              <div class="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-400">
                Пока нет заявок. Сотрудник создаёт бронь во вкладке «Бронь».
              </div>
            `}
          </div>

          ${renderPostsMatrix()}
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // Вкладка 4: Чекин 150м + Авто-напоминания (Т-7д Google Cal -> Т-5д) + Мелодия
    // -----------------------------------------------------------------------
    function renderCheckinTab() {
      const { t5Human, arrivalHuman } = getT5ReminderDates();
      const offlinePost = myOfflinePost();
      return `
        <div class="max-w-xl mx-auto space-y-3.5 min-w-0">
          <!-- Блок авто-прибытия 150м -->
          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h2 class="text-sm font-semibold text-white">Прибытие на пост (радиус 150 м) и Фото</h2>
                <p class="text-xs text-slate-400 mt-0.5">Дистанцию считает сервер по координатам поста: в радиусе ≤ 150 м статус становится «На вахте (✓)».</p>
              </div>
              ${statusIcon('on_watch')}
            </div>

            <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="text-slate-400">Геопозиция устройства</span>
                <span id="geoStatusText" class="font-medium text-slate-300 truncate">не проверена</span>
              </div>
              ${myCurrentPost() ? `
                <button type="button" data-action="geo-checkin" class="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition">
                  Проверить радиус 150 м и отметиться на №${myCurrentPost().num}
                </button>
                <p class="text-[10px] text-slate-500 leading-relaxed">
                  Нужно разрешение на геолокацию. Если пост без координат — сначала заполните «Объекты» в профиле.
                </p>` : `
                <div class="py-2.5 px-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 text-center">
                  За вами не закреплён пост — отметку ставит старший смены
                </div>
                <p class="text-[10px] text-slate-500 leading-relaxed">
                  Отметка принимается только на закреплённом посту: так присутствие нельзя подменить.
                </p>`}
            </div>

            <input id="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" />
            <button type="button" data-action="take-photo" class="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-white transition">
              ${state.capturedPhotoUrl ? 'Переснять фото на посту' : 'Сделать фото (не загружается на сервер)'}
            </button>
            ${state.capturedPhotoUrl ? `
              <div class="flex items-center gap-3 p-2 rounded-xl bg-slate-950 border border-slate-800">
                <img src="${state.capturedPhotoUrl}" alt="Фото поста" class="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0" />
                <div class="text-xs text-emerald-300 truncate">Фото прикреплено · Готово к отправке</div>
              </div>
            ` : ''}

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
              ${offlinePost ? `
                <button type="button" data-action="offline-checkin" class="w-full py-2.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs font-medium text-amber-200 transition">
                  Отметка в оффлайн-зоне (№${offlinePost.num})
                </button>` : `
                <div class="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 text-center">
                  Оффлайн-отметка — только на посту из оффлайн-зоны
                </div>`}
              ${myQueue().length > 0 ? `
                <button type="button" data-action="sync-cache" class="w-full py-2.5 px-3 rounded-xl bg-emerald-600 text-xs font-semibold text-white">
                  Отправить кэш (${myQueue().length})
                </button>` : `
                <div class="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 text-center">
                  ${foreignQueueCount() > 0 ? 'Кэш другого сотрудника — отправит он сам' : 'Кэш пуст · Сеть в норме'}
                </div>`}
            </div>
          </div>

          <!-- Блок напоминаний Т-7д (Календарь) -> Т-5д (Подтверждение) + Мелодия -->
          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3.5">
            <div>
              <h2 class="text-sm font-semibold text-white">Авто-напоминания (Т-7д → Т-5д)</h2>
              <p class="text-xs text-slate-400 mt-0.5">За 7 дней — календарь на дату Т-5д; за 5 дней — подтверждение выезда.</p>
            </div>

            <!-- Т-7д Календарь -->
            <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-semibold text-blue-300">За 7 дней (Т-7д · Календарь)</span>
                ${state.reminderT7Added ? '<span class="text-emerald-400 font-medium">Добавлено ✓</span>' : '<span class="text-slate-400">Авто-расчёт</span>'}
              </div>
              <p class="text-[11px] text-slate-300 leading-relaxed">
                Заезд <b>${arrivalHuman}</b> → подставит <b>${t5Human} (09:00)</b> с подсказкой подтвердить выезд в боте.
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a href="${buildGoogleCalUrl()}" target="_blank" rel="noopener noreferrer" class="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white text-center transition">
                  Google Календарь ↗
                </a>
                <button type="button" data-action="add-cal-ics" class="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition">
                  Скачать .ics (iOS/Android)
                </button>
              </div>
            </div>

            <!-- Фиксированная мелодия -->
            <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-semibold text-slate-200">Фиксированная мелодия уведомления</span>
                <span class="text-[10px] text-blue-300 shrink-0">Мин. 6 сек</span>
              </div>
              <div class="flex flex-col sm:flex-row gap-2">
                <select id="melodySelect" class="w-full sm:flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white outline-none min-w-0">
                  <option value="clear_pulse" ${state.selectedMelody === 'clear_pulse' ? 'selected' : ''}>1. Чёткий сигнал (6.5 сек)</option>
                  <option value="double_ring" ${state.selectedMelody === 'double_ring' ? 'selected' : ''}>2. Двойной звонок (6.5 сек)</option>
                  <option value="soft_chime" ${state.selectedMelody === 'soft_chime' ? 'selected' : ''}>3. Мягкий колокольчик (6.5 сек)</option>
                  <option value="alert_tone" ${state.selectedMelody === 'alert_tone' ? 'selected' : ''}>4. Командный акцент (6.5 сек)</option>
                </select>
                <div class="grid grid-cols-2 sm:flex gap-1.5 shrink-0">
                  <button type="button" data-action="test-melody" class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-blue-300 transition whitespace-nowrap">
                    Прослушать (6.5с)
                  </button>
                  <button type="button" data-action="stop-melody" class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-rose-600/20 border border-slate-700 text-xs font-medium text-slate-300 transition whitespace-nowrap">
                    Стоп
                  </button>
                </div>
              </div>
            </div>

            <!-- Т-5д Подтверждение -->
            <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-semibold text-emerald-300">За 5 дней (Т-5д · Подтверждение)</span>
                <span class="text-[10px] text-slate-400">Всем участникам</span>
              </div>
              ${state.reminderT5Status === 'confirmed' ? `
                <div class="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300">
                  ✓ Приезд подтверждён! Статус синхронизирован у №20, №19 и «Рубежа».
                </div>
              ` : state.reminderT5Status === 'declined' ? `
                <div class="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
                  Отказ отправлен №20, №19 и «Рубежу» для подбора замены.
                </div>
              ` : `
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button type="button" data-action="confirm-t5" class="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition">
                    Подтверждаю приезд
                  </button>
                  <button type="button" data-action="decline-t5" class="w-full py-2.5 px-3 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-xs font-medium text-rose-300 transition">
                    Не смогу
                  </button>
                </div>
              `}
            </div>
          </div>
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // Вкладка 5: Обучение / Гид — аттестация (этап 6) и ИИ-ассистент (этап 5)
    // -----------------------------------------------------------------------
    const AI_FAQ = {
      guard: [
        'Как забронировать вахту на 3–12 месяцев и получить приоритет?',
        'Как запланировать 2–3 месяца подряд?',
        'Как отметиться на чекине в 150 м и что делать в подземном паркинге (№4/№12)?',
        'Как сдать тест «Лобби и ТГ» для постов №5, №6, №8?',
        'Какие цвета статусов что означают?',
        'Как загрузить фото профиля?',
        'Как настроить напоминание T-5d в Google Календарь?',
        'Что делать при «Коде Жёлтом» и «Коде Красном»?',
        'Какие габариты допустимы в подземный паркинг?',
        'Как войти в приложение без Telegram по ПИН-коду?',
        'Что запрещено на постах Лобби и ТГ?',
        'Куда докладывать об авариях и поломках?'
      ],
      cmd: [
        'Как утвердить заявку и перевести сотрудника на другой пост?',
        'Как считается балл приоритета в «Заявках»?',
        'Как проверить, кто сдал обязательный тест «Лобби и ТГ» и сколько времени учился?',
        'Как сделать экстренную замену поста без аттестации с записью в журнал?',
        'Как убрать пост из работы («удалить пост»)?',
        'Как добавить или отключить пост в Матрице постов?',
        'Как поменять сотруднику пост, роль или дисциплину?',
        'Как вручную скорректировать блоки вахты сотрудника (циклы 13/28)?',
        'Как выдать ПИН-код сотруднику без Telegram?',
        'Какие действия Старшего смены как РПМ в нерабочее время (18:00–09:00)?',
        'Как оформить отчёт при ложном срабатывании АПС?',
        'Что передавать полиции при вооружённом нападении?'
      ],
      dev: [
        'Какие слабые места сейчас в логике скоринга и расстановки?',
        'Как безопасно изменить веса приоритета через app_config?',
        'Как добавить новый модуль или вопрос в аттестацию?',
        'Как проверить статус /health и RLS-политики?',
        'Какие метрики дисциплины стоит добавить в будущем?',
        'Как оптимизировать экран «База» для 360px/390px?',
        'Сгенерируй JSON-патч app_config для изменения порога аттестации или текстов.',
        'Как проверить логи audit_logs по ручным заменам постов?',
        'Как ускорить ответы ассистента и не зависеть от квоты Gemini?'
      ]
    };

    function attModuleBySlug(slug) {
      const att = state.attestation;
      if (!att || !Array.isArray(att.modules)) return null;
      return att.modules.find(m => m.slug === slug) || null;
    }
    function attSummaryBySlug(slug) {
      const s = state.attestation && state.attestation.summary;
      if (!s || !Array.isArray(s.modules)) return null;
      return s.modules.find(m => m.slug === slug) || null;
    }

    function renderAttestationBlock() {
      const att = state.attestation;
      if (!att) {
        return `
          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 text-xs text-slate-400">
            Аттестация недоступна: не удалось загрузить модули.
          </div>`;
      }
      const myPost = att.my_post_number;
      const clear = myPost != null ? att.clearance && att.clearance[String(myPost)] : null;
      const modules = att.modules || [];
      const summary = att.summary || { modules: [], ok: false, study_seconds_total: 0 };
      const passedCount = (summary.modules || []).filter(m => m.passed).length;
      const pct = modules.length ? Math.round((passedCount / modules.length) * 100) : 0;

      return `
        <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3 min-w-0">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-white">Аттестация и время обучения</h2>
              <p class="text-xs text-slate-400">Порог сдачи ${att.settings && att.settings.pass_threshold ? att.settings.pass_threshold : 80}%. Время считается по активной вкладке.</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs font-semibold ${summary.ok ? 'text-emerald-400' : 'text-amber-300'}">${passedCount}/${modules.length} сдано</span>
              ${canCommand() ? `
                <button type="button" data-action="att-tab" data-val="${state.attTab === 'report' ? 'modules' : 'report'}" class="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200">
                  ${state.attTab === 'report' ? 'К модулям' : 'Сводка по 35'}
                </button>` : ''}
            </div>
          </div>

          <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-500 transition-all" style="width: ${pct}%"></div>
          </div>

          ${myPost != null && clear === false ? `
            <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
              ⚠ Для поста №${myPost} не сдан обязательный модуль. Назначение вернёт 409 — нужна экстренная замена командира.
            </div>` : ''}

          ${state.attTab === 'report' && canCommand() ? renderAttReport() : `
            <div class="space-y-2">
              ${modules.map(m => {
                const s = attSummaryBySlug(m.slug) || {};
                const mandatory = (m.required_for_posts || []).length > 0;
                const postsLabel = (m.required_for_posts || []).map(n => '№' + n).join(', ');
                return `
                  <div class="rounded-xl border ${m.required_for_all || mandatory ? 'border-blue-500/40' : 'border-slate-800'} bg-slate-900/60 p-3 space-y-2 min-w-0">
                    <div class="flex items-start justify-between gap-2 min-w-0">
                      <div class="min-w-0">
                        <div class="text-xs font-semibold text-white">${escHtml(m.title)}</div>
                        <div class="text-[10px] text-slate-400 mt-0.5">${escHtml(m.description || '')}</div>
                      </div>
                      <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded ${s.passed ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-300'}">${s.passed ? '✓ сдан' : 'не сдан'}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 text-[10px]">
                      ${m.required_for_all ? '<span class="px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-200 border border-blue-500/30">Для всех</span>' : ''}
                      ${mandatory ? `<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-semibold">Обязательно для ${postsLabel}</span>` : ''}
                      <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">${m.question_count} вопросов</span>
                      <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">лучший: ${s.best_percent || 0}%</span>
                      <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">изучено: ${fmtMinutes(s.study_seconds || 0)}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-1.5">
                      <button type="button" data-action="study-module" data-slug="${escHtml(m.slug)}" class="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-100">Читать конспект</button>
                      <button type="button" data-action="test-module" data-slug="${escHtml(m.slug)}" class="py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold text-white">Пройти тест</button>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          `}
        </div>
      `;
    }

    function renderAttReport() {
      const rows = state.attReport;
      if (!rows) {
        return `<div class="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400">Загружаю сводку…</div>`;
      }
      const prep = rows.map((r) => {
        const mods = (r.summary && r.summary.modules) || [];
        return {
          name: r.name || '—',
          post: r.post || '—',
          passed: mods.filter((m) => m.passed).length,
          total: mods.length || 5,
          best: mods.reduce((m, x) => Math.max(m, x.best_percent || 0), 0),
          time: fmtMinutes((r.summary && r.summary.study_seconds_total) || 0),
          ok: Boolean(r.summary && r.summary.ok)
        };
      });
      return `
        <div class="space-y-2 min-w-0">
          <div class="text-[11px] text-slate-400">Сданные модули, лучший %, время изучения и допуск по всем сотрудникам.</div>

          <div class="sm:hidden space-y-1.5">
            ${prep.map((p) => `
              <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2 space-y-1 min-w-0">
                <div class="flex items-start justify-between gap-2 min-w-0">
                  <div class="min-w-0">
                    <div class="text-[11px] font-semibold text-white truncate">${escHtml(p.name)}</div>
                    <div class="text-[10px] text-slate-400 truncate">${escHtml(p.post)}</div>
                  </div>
                  <span class="shrink-0 text-[10px] font-semibold ${p.ok ? 'text-emerald-400' : 'text-amber-300'}">${p.ok ? '✓ допуск' : '⚠ нет'}</span>
                </div>
                <div class="flex flex-wrap gap-1 text-[10px]">
                  <span class="px-1.5 py-0.5 rounded-md bg-slate-800/70 text-slate-300">Сдано ${p.passed}/${p.total}</span>
                  <span class="px-1.5 py-0.5 rounded-md bg-slate-800/70 text-slate-300">Лучший ${p.best}%</span>
                  <span class="px-1.5 py-0.5 rounded-md bg-slate-800/70 text-slate-300">${p.time}</span>
                </div>
              </div>`).join('')}
          </div>

          <div class="hidden sm:block overflow-x-auto">
            <table class="w-full text-[10px]">
              <thead class="text-slate-400">
                <tr class="text-left">
                  <th class="py-1 pr-2 font-medium">Сотрудник</th>
                  <th class="py-1 pr-2 font-medium">Пост</th>
                  <th class="py-1 pr-2 font-medium">Сдано</th>
                  <th class="py-1 pr-2 font-medium">Лучший</th>
                  <th class="py-1 pr-2 font-medium">Время</th>
                  <th class="py-1 font-medium">Допуск</th>
                </tr>
              </thead>
              <tbody>
                ${prep.map((p) => `
                  <tr class="border-t border-slate-800/70">
                    <td class="py-1 pr-2 text-slate-200">${escHtml(p.name)}</td>
                    <td class="py-1 pr-2 text-slate-400">${escHtml(p.post)}</td>
                    <td class="py-1 pr-2 tabular-nums text-slate-300">${p.passed}/${p.total}</td>
                    <td class="py-1 pr-2 tabular-nums text-slate-300">${p.best}%</td>
                    <td class="py-1 pr-2 tabular-nums text-slate-300">${p.time}</td>
                    <td class="py-1 ${p.ok ? 'text-emerald-400' : 'text-amber-300'}">${p.ok ? '✓' : '⚠'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    function renderAiBlock() {
      const role = state.me ? state.me.role : state.role;
      const isDev = role === 'developer';
      const isCmd = ['chief', 'senior_20', 'senior_19_night'].includes(role);
      const lists = [];
      lists.push({ key: 'guard', title: 'Охранникам', items: AI_FAQ.guard });
      if (isCmd || isDev) lists.push({ key: 'cmd', title: 'Командирам', items: AI_FAQ.cmd });
      if (isDev) lists.push({ key: 'dev', title: 'Разработчику', items: AI_FAQ.dev });

      return `
        <div class="bg-[#111827] border border-blue-500/30 rounded-2xl p-4 space-y-3 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-white">ИИ-Ассистент</h2>
              <p class="text-xs text-slate-400">Отвечает по карте приложения и правилам объекта. Ключ хранится только на сервере.</p>
            </div>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 shrink-0 whitespace-nowrap">${roleLabel(role)}</span>
          </div>

          <div class="space-y-1.5">
            ${lists.map(l => `
              <select data-ai-faq="${l.key}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-[11px] text-slate-200 outline-none min-w-0">
                <option value="">${l.title}: частый вопрос…</option>
                ${l.items.map(q => `<option value="${q.replace(/"/g, '&quot;')}">${q}</option>`).join('')}
              </select>
            `).join('')}
          </div>

          <div id="aiChatLog" class="space-y-2 max-h-72 overflow-y-auto">
            ${state.aiChat.length ? state.aiChat.map(m => `
              <div class="p-2.5 rounded-xl text-[11px] leading-relaxed ${m.role === 'user' ? 'bg-blue-600/15 border border-blue-500/30 text-blue-100 ml-6' : 'bg-slate-950 border border-slate-800 text-slate-200 mr-6'}">
                <div class="text-[9px] uppercase tracking-wide ${m.role === 'user' ? 'text-blue-300' : 'text-slate-500'} mb-1">${m.role === 'user' ? 'Вы' : `Ассистент${m.provider === 'knowledge' ? ' · мгновенно' : (m.ms ? ' · ' + (m.ms / 1000).toFixed(1).replace('.', ',') + ' с' : '') + (m.provider === 'gemini' ? ' · резервный канал' : '')}`}</div>
                ${m.note ? `<div class="text-[9px] text-slate-600 mb-1">по карте: «${m.note.replace(/</g, '&lt;')}»</div>` : ''}
                <div class="whitespace-pre-wrap break-words">${m.text.replace(/</g, '&lt;')}</div>
              </div>
            `).join('') : `<div class="text-[11px] text-slate-500 p-2">Задайте вопрос или выберите готовый из списка выше.</div>`}
            ${state.aiBusy ? `<div class="text-[11px] text-slate-400 p-2">Ассистент печатает…</div>` : ''}
          </div>

          <div class="space-y-1.5">
            <textarea id="aiInput" rows="2" placeholder="Свой вопрос по объекту или приложению…" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-[11px] text-slate-100 placeholder:text-slate-600 outline-none resize-none"></textarea>
            <div class="flex gap-1.5">
              <button type="button" data-action="ai-send" class="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold text-white">Спросить</button>
              <button type="button" data-action="ai-clear" class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300">Очистить</button>
            </div>
            <p class="text-[10px] text-slate-500">Лимит 30 вопросов в час на сотрудника.</p>
          </div>
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // Карта приложения: те же данные, что уходят ИИ-ассистенту (knowledge/*.md)
    // -----------------------------------------------------------------------
    const APP_MAP = [
      {
        tab: 'base', icon: '👥', title: 'База', who: 'все · правка — командиры',
        items: ['сотрудники, поиск и фильтры', 'пост, смена, дисциплина, «костяк»', '«✎ Редактировать» — только командиры']
      },
      {
        tab: 'booking', icon: '📅', title: 'Бронь', who: 'все',
        items: ['циклы 13→27 и 28→12, сдача поста 08:00', 'пресеты 3/6/12 мес., клик = работа/отдых', '«Отправить заявку» → карточка в «Заявках»']
      },
      {
        tab: 'applicants', icon: '✅', title: 'Заявки', who: 'решают командиры',
        items: ['шаг 1 «Утвердить на вахту (◎)»', 'шаг 2 «Подтвердить пост»', '«Матрица постов»: ✎ правка, ⏻ в архив']
      },
      {
        tab: 'checkin', icon: '📍', title: 'Чекин', who: 'все',
        items: ['прибытие по гео, радиус 150 м', '№4 и №12 — оффлайн-кэш', 'фото остаётся на устройстве']
      },
      {
        tab: 'learning', icon: '🎓', title: 'Гид', who: 'все',
        items: ['аттестация: 5 модулей, порог 80%', 'озвучка вопросов, пересдача иначе', 'ИИ-ассистент: 30 вопросов в час']
      }
    ];

    function renderAppMap() {
      return `
        <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3 min-w-0">
          <div>
            <h2 class="text-sm font-semibold text-white">Карта приложения</h2>
            <p class="text-xs text-slate-400 mt-0.5">Пять вкладок — и всё, что можно сделать. По этой же карте отвечает ИИ-ассистент.</p>
          </div>

          <div class="space-y-1.5">
            ${APP_MAP.map((m, i) => `
              <button type="button" data-action="open-map-tab" data-tab="${m.tab}" class="w-full text-left p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500/50 transition flex items-start gap-2.5 min-w-0">
                <span class="shrink-0 w-6 h-6 rounded-lg bg-slate-900 border border-slate-700 text-[11px] flex items-center justify-center">${m.icon}</span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[11px] font-semibold text-white">${i + 1}. ${escHtml(m.title)}</span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400">${m.who}</span>
                  </span>
                  <span class="block text-[10px] text-slate-400 leading-relaxed mt-0.5">${m.items.join(' · ')}</span>
                </span>
              </button>
            `).join('')}
          </div>

          <div class="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25">
            <div class="text-[10px] text-blue-200 leading-relaxed">
              <b>Поток вахты:</b> Бронь → заявка → Заявки (утвердить выход) → Заявки (подтвердить пост) → Чекин на посту.
              Аттестация в «Гиде» — по желанию: сданный материал отмечается зелёным «✓ аттестация», непройденный — тихой пометкой «материал к изучению».
            </div>
          </div>
        </div>
      `;
    }

    function renderLearningTab() {
      const watchedCount = Object.keys(state.watchedVideos).filter(k => state.watchedVideos[k]).length;
      const pct = Math.round((watchedCount / VIDEO_PLAN.length) * 100);
      const filteredVideos = VIDEO_PLAN.filter(v => {
        if (state.videoFilter === 'guard') return v.audience === 'Для всех' || v.audience === 'Охранники';
        if (state.videoFilter === 'cmd') return v.audience === 'Для всех' || v.audience.includes('Рубеж');
        return true;
      });
      const activeVid = VIDEO_PLAN.find(v => v.id === state.selectedVideoId) || VIDEO_PLAN[0];
      const isWatched = Boolean(state.watchedVideos[activeVid.id]);

      return `
        <div class="space-y-4 min-w-0">
          ${renderAppMap()}
          ${renderAttestationBlock()}
          ${renderAiBlock()}

          <!-- Прогресс по роликам -->
          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold text-white">Видео-инструкции · «Стоун Охрана»</h2>
                <p class="text-xs text-slate-400 mt-0.5">Короткие ролики 9:16 для быстрого старта.</p>
              </div>
              <span class="text-xs font-semibold text-emerald-400 tabular-nums shrink-0">Пройдено: ${watchedCount}/${VIDEO_PLAN.length}</span>
            </div>
            <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500 transition-all" style="width: ${pct}%"></div>
            </div>
          </div>

          <div class="bg-[#111827] border border-blue-500/30 rounded-2xl p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-blue-300">Ролик №${activeVid.id} · ${activeVid.dur}</span>
              <span class="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[10px] text-emerald-300">${activeVid.audience}</span>
            </div>

            <div class="rounded-xl bg-gradient-to-br from-slate-900 via-[#0F172A] to-blue-950/60 border border-slate-800 p-5 flex flex-col items-center justify-center text-center gap-2.5 min-h-[150px]">
              <button type="button" data-action="mark-video-watched" data-vid="${activeVid.id}" class="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg transition text-base">
                ${isWatched ? '✓' : '▶'}
              </button>
              <div class="text-sm font-semibold text-white max-w-md">${activeVid.title}</div>
              <p class="text-xs text-slate-300 max-w-md leading-relaxed">${activeVid.desc}</p>
            </div>

            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
              <span class="text-[11px] text-slate-400">${isWatched ? 'Ролик отмечен как просмотренный ✓' : 'Нажмите ▶, чтобы запустить и отметить просмотр'}</span>
              <button type="button" data-action="mark-video-watched" data-vid="${activeVid.id}" class="w-full sm:w-auto px-3.5 py-2 rounded-xl ${isWatched ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-300' : 'bg-blue-600 hover:bg-blue-500 text-white'} text-xs font-semibold transition">
                ${isWatched ? 'Просмотрено ✓' : 'Отметить как изученное'}
              </button>
            </div>
          </div>

          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-semibold text-white">Все краткие видеоролики</span>
              <div class="grid grid-cols-3 gap-1 bg-slate-900 p-0.5 rounded-xl border border-slate-800">
                <button type="button" data-action="set-vid-filter" data-val="all" class="px-2.5 py-1 rounded-lg text-[11px] font-medium ${state.videoFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400'}">Все</button>
                <button type="button" data-action="set-vid-filter" data-val="guard" class="px-2.5 py-1 rounded-lg text-[11px] font-medium ${state.videoFilter === 'guard' ? 'bg-blue-600 text-white' : 'text-slate-400'}">Охранник</button>
                <button type="button" data-action="set-vid-filter" data-val="cmd" class="px-2.5 py-1 rounded-lg text-[11px] font-medium ${state.videoFilter === 'cmd' ? 'bg-blue-600 text-white' : 'text-slate-400'}">Командир</button>
              </div>
            </div>

            <div class="space-y-2">
              ${filteredVideos.map(v => {
                const done = Boolean(state.watchedVideos[v.id]);
                const sel = v.id === activeVid.id;
                return `
                  <button type="button" data-action="select-video" data-vid="${v.id}" class="w-full text-left p-3 rounded-xl border transition flex items-start justify-between gap-3 ${sel ? 'bg-blue-600/15 border-blue-500/50' : 'bg-slate-950 border-slate-800 hover:border-slate-700'}">
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-semibold text-white">${v.id}. ${v.title}</div>
                      <div class="text-[11px] text-slate-400 mt-0.5">${v.audience} · ${v.dur}</div>
                    </div>
                    <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] shrink-0 ${done ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-300'}">${done ? '✓' : '▶'}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div class="bg-[#111827] border border-slate-800/90 rounded-2xl p-4 space-y-2.5">
            <div class="text-xs font-semibold text-white">Краткие пояснения: какая кнопка за что отвечает</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              ${TOUR_STEPS.map(s => `
                <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div class="text-xs font-semibold text-blue-300">${s.title}</div>
                  <div class="text-[11px] text-emerald-400">${s.goal}</div>
                  <p class="text-[11px] text-slate-400 leading-relaxed">${s.body}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // Главный рендер
    // -----------------------------------------------------------------------
    function render() {
      // Короткий подзаголовок: «Рубеж» · 36 чел. — не обрезается на 390px
      document.getElementById('roleSubtitle').textContent = `${roleLabel(state.role)} · ${state.staff.length} чел.`;

      document.querySelectorAll('.tab-btn').forEach(b => {
        b.className = `tab-btn px-3 py-1.5 rounded-lg text-xs font-medium transition ${b.dataset.tab === state.activeTab ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`;
      });
      document.querySelectorAll('.mob-tab-btn').forEach(b => {
        b.className = `mob-tab-btn py-1.5 px-0.5 rounded-xl text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 min-w-0 transition ${b.dataset.tab === state.activeTab ? 'text-blue-400 bg-blue-600/15' : 'text-slate-400 hover:text-slate-200'}`;
      });

      const main = document.getElementById('mainContent');
      if (state.activeTab === 'base') main.innerHTML = renderBaseTab();
      else if (state.activeTab === 'booking') main.innerHTML = renderBookingTab();
      else if (state.activeTab === 'applicants') main.innerHTML = renderApplicantsTab();
      else if (state.activeTab === 'checkin') main.innerHTML = renderCheckinTab();
      else main.innerHTML = renderLearningTab();

      // Аттестация подгружается при первом открытии «Гида»
      if (state.activeTab === 'learning' && state.authOk && !state.attestation) void loadAttestation();
      if (state.activeTab === 'learning' && state.attTab === 'report' && canCommand() && !state.attReport) void loadAttReport();
      saveAppState();
    }

    // -----------------------------------------------------------------------
    // Обработчики событий
    // -----------------------------------------------------------------------
    function handleTabClick(e) {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      state.activeTab = btn.dataset.tab;
      render();
    }
    document.getElementById('desktopNav').addEventListener('click', handleTabClick);
    document.getElementById('mobileBottomNav').addEventListener('click', handleTabClick);

    document.getElementById('profileGuideBtn').addEventListener('click', () => {
      document.getElementById('profileModal').classList.add('hidden');
      document.getElementById('guideModal').classList.remove('hidden');
      renderGuideModal();
    });
    document.getElementById('closeGuideModalBtn').addEventListener('click', () => {
      document.getElementById('guideModal').classList.add('hidden');
    });
    document.getElementById('guideModalTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.gtab-btn');
      if (!btn) return;
      state.guideTab = btn.dataset.gtab;
      renderGuideModal();
    });
    document.getElementById('guideModalFooter').addEventListener('click', (e) => {
      if (e.target.id === 'guidePrevBtn' && state.guideStep > 0) {
        state.guideStep -= 1;
        renderGuideModal();
      } else if (e.target.id === 'guideNextBtn') {
        if (state.guideStep < TOUR_STEPS.length - 1) {
          state.guideStep += 1;
          renderGuideModal();
        } else {
          document.getElementById('guideModal').classList.add('hidden');
          showToast('Обучение пройдено! Вы всегда можете открыть его снова кнопкой «? Обучение».');
        }
      } else if (e.target.id === 'guideDoneBtn') {
        document.getElementById('guideModal').classList.add('hidden');
      }
    });

    // Кнопка в шапке: «Вход» открывает экран входа, «Выход» закрывает сессию
    function syncAuthButton() {
      const b = document.getElementById('openAuthModalBtn');
      if (!b) return;
      const on = !!state.authOk;
      b.textContent = on ? 'Выход' : 'Вход';
      b.classList.toggle('text-rose-300', on);
      b.classList.toggle('border-rose-500/40', on);
    }
    // --- Профиль сотрудника и аватар ---------------------------------------
    const AVATAR_MAX_BYTES = 300 * 1024;
    const AVATAR_SIDE = 160;

    function initialsOf(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return 'СО';
      return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    function myAvatarUrl() {
      return (state.me && state.me.avatar_url) || '';
    }

    function syncHeaderAvatar() {
      const url = myAvatarUrl();
      const ini = initialsOf(state.me && state.me.full_name);
      [['headerAvatarImg', 'headerAvatarFallback', 'text-[10px] font-bold text-slate-300'],
       ['profileAvatarImg', 'profileAvatarFallback', 'text-lg font-bold text-slate-400']].forEach(([imgId, fbId, fbCls]) => {
        const img = document.getElementById(imgId);
        const fb = document.getElementById(fbId);
        if (!img || !fb) return;
        if (url) {
          img.src = url;
          img.classList.remove('hidden');
          fb.classList.add('hidden');
        } else {
          img.removeAttribute('src');
          img.classList.add('hidden');
          fb.className = fbCls + ' shrink-0';
          fb.classList.remove('hidden');
          fb.textContent = ini;
        }
      });
    }

    function profileStatus(text, kind) {
      const el = document.getElementById('profileStatus');
      if (!el) return;
      if (!text) { el.className = 'hidden'; el.textContent = ''; return; }
      const tone = kind === 'error'
        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        : kind === 'ok'
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-slate-900 border-slate-700 text-slate-300';
      el.className = 'text-[11px] px-3 py-2 rounded-xl border ' + tone;
      el.textContent = text;
    }

    function openProfileModal() {
      document.getElementById('profileModal').classList.remove('hidden');
      document.getElementById('profileSubtitle').textContent = state.me
        ? `${state.me.full_name} · ${roleLabel(state.me.role)}`
        : (state.authOk ? roleLabel(state.role) : 'Вход не выполнен');
      profileStatus(state.authOk ? '' : 'Загрузка фото доступна только после входа.', 'error');
      syncHeaderAvatar();
    }

    // Квадрат 160×160 JPEG через canvas: EXIF не переносится, остаются только пиксели
    function cropToSquareJpeg(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
          try {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - side) / 2;
            const sy = (img.naturalHeight - side) / 2;
            const canvas = document.createElement('canvas');
            canvas.width = AVATAR_SIDE;
            canvas.height = AVATAR_SIDE;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0B0F17';
            ctx.fillRect(0, 0, AVATAR_SIDE, AVATAR_SIDE);
            ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
            URL.revokeObjectURL(objUrl);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Не удалось сжать изображение')), 'image/jpeg', 0.86);
          } catch (err) {
            URL.revokeObjectURL(objUrl);
            reject(err);
          }
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Файл не является изображением')); };
        img.src = objUrl;
      });
    }

    async function postAvatar(action, body, contentType) {
      const headers = Object.assign({}, STONE_API_HEADERS, authHeaders());
      if (contentType) headers['Content-Type'] = contentType;
      const res = await fetch(STONE_API_URL + '/' + action, { method: 'POST', headers, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    document.getElementById('openAvatarModalBtn').addEventListener('click', openProfileModal);
    document.getElementById('closeProfileModalBtn').addEventListener('click', () => {
      document.getElementById('profileModal').classList.add('hidden');
    });
    document.getElementById('profileModal').addEventListener('click', (e) => {
      if (e.target.id === 'profileModal') e.currentTarget.classList.add('hidden');
    });

    document.getElementById('profileUploadBtn').addEventListener('click', () => {
      if (!state.authOk) { profileStatus('Сначала войдите в панель.', 'error'); return; }
      document.getElementById('avatarFileInput').click();
    });

    document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { profileStatus('Нужен файл изображения (JPEG, PNG, WebP).', 'error'); return; }
      if (file.size > 12 * 1024 * 1024) { profileStatus('Файл больше 12 МБ — выберите другое фото.', 'error'); return; }
      try {
        profileStatus('Готовлю квадрат 160×160…', 'info');
        const blob = await cropToSquareJpeg(file);
        if (blob.size > AVATAR_MAX_BYTES) throw new Error('После сжатия файл больше 300 КБ');
        profileStatus('Загружаю в Supabase Storage…', 'info');
        const data = await postAvatar('upload-avatar', blob, 'image/jpeg');
        if (state.me) state.me.avatar_url = data.avatar_url || '';
        syncHeaderAvatar();
        profileStatus('Фото обновлено.', 'ok');
        showToast('Аватар обновлён.');
        await loadCloudData(true);
        syncHeaderAvatar();
      } catch (err) {
        profileStatus('Ошибка: ' + (err && err.message ? err.message : err), 'error');
      }
    });

    document.getElementById('profileResetBtn').addEventListener('click', async () => {
      if (!state.authOk) { profileStatus('Сначала войдите в панель.', 'error'); return; }
      try {
        await postAvatar('reset-avatar', '{}', 'application/json');
        if (state.me) state.me.avatar_url = '';
        syncHeaderAvatar();
        profileStatus('Аватар сброшен.', 'ok');
        showToast('Аватар удалён.');
        await loadCloudData(true);
        syncHeaderAvatar();
      } catch (err) {
        profileStatus('Ошибка: ' + (err && err.message ? err.message : err), 'error');
      }
    });

    // Полный выход: гасим сессию на сервере (версия сессии растёт, старый токен
    // становится недействительным) и стираем локальные копии персональных данных.
    async function clearLocalSession(revoke = true) {
      if (revoke && sessionToken) {
        try {
          await fetch(STONE_API_URL + '/logout', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: '{}'
          });
        } catch (_) {}
      }
      sessionToken = '';
      try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
      try { localStorage.removeItem('stone_wfm_state_v1'); } catch (_) {}
      // Очередь оффлайн-отметок принадлежит сотруднику: после выхода она не должна
      // уйти от имени следующего, кто сядет за это устройство (M1).
      clearOfflineQueue();
      state.authOk = false;
      state.me = null;
      state.authVia = '';
      state.staff = [];
      state.applicants = [];
      state.myBooking = null;
      state.postsAll = [];
      POSTS_LIST.length = 0;
      syncAuthButton();
      syncHeaderAvatar();
    }

    document.getElementById('openAuthModalBtn').addEventListener('click', async () => {
      if (state.authOk) {
        await clearLocalSession(true);
        resetGate();
        showAuthGate();
        showToast('Сессия закрыта. Данные снова доступны после входа.');
        return;
      }
      showAuthGate();
    });
    // --- Модалка «Объекты и доступы» ---------------------------------------
    document.getElementById('profileSetupBtn').addEventListener('click', () => {
      document.getElementById('profileModal').classList.add('hidden');
      document.getElementById('setupModal').classList.remove('hidden');
      renderSetupModal();
      void loadSetupStatus();
    });
    document.getElementById('closeSetupModalBtn').addEventListener('click', () => {
      document.getElementById('setupModal').classList.add('hidden');
    });
    document.getElementById('setupModal').addEventListener('click', (e) => {
      if (e.target.id === 'setupModal') e.currentTarget.classList.add('hidden');
    });
    document.querySelectorAll('.setup-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.setupTab = btn.dataset.setupTab;
        renderSetupModal();
      });
    });
    document.getElementById('setupRefreshBtn').addEventListener('click', async () => {
      const btn = document.getElementById('setupRefreshBtn');
      btn.disabled = true;
      try {
        await loadCloudData(true);
        await loadSetupStatus();
        renderSetupModal();
        showToast('Список постов и доступов синхронизирован с сервером.');
      } catch (err) {
        showToast('Не удалось обновить: ' + (err && err.message ? err.message : err));
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById('setupBody').addEventListener('click', async (e) => {
      const geoBtn = e.target.closest('[data-geo-post]');
      const saveBtn = e.target.closest('[data-save-post]');
      const clearBtn = e.target.closest('[data-clear-post]');
      const tgBtn = e.target.closest('[data-save-tg]');
      const toggle = e.target.closest('[data-toggle-staff]');
      const issuePinBtn = e.target.closest('[data-issue-pin]');
      const revokePinBtn = e.target.closest('[data-revoke-pin]');
      const copyPinBtn = e.target.closest('[data-copy-pin]');

      if (copyPinBtn) {
        const val = copyPinBtn.dataset.copyPin;
        try {
          await navigator.clipboard.writeText(val);
          showToast('Код скопирован в буфер обмена.');
        } catch (_) {
          showToast('Код: ' + val);
        }
        return;
      }

      if (issuePinBtn) {
        const id = Number(issuePinBtn.dataset.issuePin);
        const phoneEl = document.getElementById('setupPinPhone' + id);
        const phone = ((phoneEl || {}).value || '').trim();
        if (phone.replace(/\D/g, '').length < 10) {
          showToast('Введите номер: +7 999 123-45-67');
          if (phoneEl) phoneEl.focus();
          return;
        }
        const old = issuePinBtn.textContent;
        issuePinBtn.disabled = true;
        issuePinBtn.textContent = '…';
        try {
          const r = await stoneApi('issue-pin', { employee_id: id, phone: phone });
          state.lastPin = {
            id: r.employee_id,
            name: r.name,
            pin: r.pin,
            phone: r.phone_masked || r.phone
          };
          await loadSetupStatus();
          showToast(`Код для ${r.name} готов — передайте лично.`);
        } catch (err) {
          showToast('Не выдано: ' + (err && err.message ? err.message : err));
        } finally {
          issuePinBtn.disabled = false;
          issuePinBtn.textContent = old;
        }
        return;
      }

      if (revokePinBtn) {
        const id = Number(revokePinBtn.dataset.revokePin);
        revokePinBtn.disabled = true;
        try {
          const r = await stoneApi('revoke-pin', { employee_id: id });
          if (state.lastPin && state.lastPin.id === id) state.lastPin = null;
          await loadSetupStatus();
          showToast(`${r.name}: код отозван.`);
        } catch (err) {
          showToast('Ошибка: ' + (err && err.message ? err.message : err));
        } finally {
          revokePinBtn.disabled = false;
        }
        return;
      }

      if (toggle) {
        state.showAllStaff = !state.showAllStaff;
        renderSetupModal();
        return;
      }

      if (geoBtn) {
        const num = Number(geoBtn.dataset.geoPost);
        geoBtn.textContent = '… поиск GPS';
        geoBtn.disabled = true;
        const pos = await getGeoPosition();
        geoBtn.disabled = false;
        geoBtn.textContent = '📍 Мои координаты';
        if (!pos) {
          showToast('GPS недоступен. Разрешите геолокацию или введите координаты вручную.');
          return;
        }
        const latEl = document.getElementById('setupLat' + num);
        const lonEl = document.getElementById('setupLon' + num);
        if (latEl) latEl.value = pos.lat.toFixed(6);
        if (lonEl) lonEl.value = pos.lon.toFixed(6);
        try {
          await cloudSetPostCoords(num, Number(pos.lat.toFixed(6)), Number(pos.lon.toFixed(6)), null);
          const p = POSTS_LIST.find(x => x.num === num);
          if (p) { p.lat = Number(pos.lat.toFixed(6)); p.lon = Number(pos.lon.toFixed(6)); }
          showToast(`Пост №${num}: координаты сохранены (точность ±${pos.accuracy} м).`);
          await loadSetupStatus();
        } catch (err) {
          showToast('Не сохранилось: ' + (err && err.message ? err.message : err));
        }
        return;
      }

      if (saveBtn) {
        const num = Number(saveBtn.dataset.savePost);
        const lat = parseFloat((document.getElementById('setupLat' + num) || {}).value);
        const lon = parseFloat((document.getElementById('setupLon' + num) || {}).value);
        if (!isFinite(lat) || !isFinite(lon)) {
          showToast('Введите широту и долготу числом.');
          return;
        }
        try {
          await cloudSetPostCoords(num, lat, lon, null);
          const p = POSTS_LIST.find(x => x.num === num);
          if (p) { p.lat = lat; p.lon = lon; }
          showToast(`Пост №${num}: координаты сохранены.`);
          await loadSetupStatus();
        } catch (err) {
          showToast('Ошибка: ' + (err && err.message ? err.message : err));
        }
        return;
      }

      if (clearBtn) {
        const num = Number(clearBtn.dataset.clearPost);
        try {
          await cloudSetPostCoords(num, null, null, null);
          const p = POSTS_LIST.find(x => x.num === num);
          if (p) { p.lat = null; p.lon = null; }
          showToast(`Пост №${num}: координаты сброшены.`);
          await loadSetupStatus();
        } catch (err) {
          showToast('Ошибка: ' + (err && err.message ? err.message : err));
        }
        return;
      }

      if (tgBtn) {
        const id = Number(tgBtn.dataset.saveTg);
        const raw = ((document.getElementById('setupTg' + id) || {}).value || '').trim();
        const tgId = Number(raw);
        if (!raw || !isFinite(tgId) || tgId <= 0) {
          showToast('Telegram ID — положительное число.');
          return;
        }
        try {
          const r = await cloudSetEmployeeTelegram(id, tgId);
          showToast(`${r.name}: привязан Telegram ID ${r.telegram_id}.`);
          await loadCloudData(true);
          await loadSetupStatus();
        } catch (err) {
          showToast('Ошибка: ' + (err && err.message ? err.message : err));
        }
      }
    });

    document.getElementById('mainContent').addEventListener('input', (e) => {
      if (e.target.id === 'staffSearchInput') {
        state.searchQuery = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const inp = document.getElementById('staffSearchInput');
        if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
        return;
      }
    });

    document.getElementById('mainContent').addEventListener('change', (e) => {
      if (e.target.id === 'bookingModeSelect') {
        state.bookingMode = e.target.value;
        render();
      } else if (e.target.id === 'melodySelect') {
        state.selectedMelody = e.target.value;
        playFixedNotificationSound(state.selectedMelody);
        showToast('Фиксированная мелодия уведомления обновлена.');
      } else if (e.target.id === 'bookingDateInput') {
        const picked = e.target.value;
        // Цикл может начинаться только 13 или 28 числа — подтягиваем к ближайшему якорю.
        const snapped = anchorOnOrAfter(picked);
        state.bookingStart = snapped;
        if (picked && snapped !== picked) {
          showToast(`Заступление только 13 или 28 числа — выбрано ${snapped.slice(8, 10)}.${snapped.slice(5, 7)} (${HANDOVER_TIME}).`);
        }
        const types = state.planBlocks.map((b) => b.type);
        const starts = planCycleStarts(types.length);
        state.planBlocks = types.map((t, i) => ({
          start: starts[i],
          end: addDaysToIso(starts[i + 1], -1),
          type: t,
          manual: false
        }));
        state.planDirty = true;
        render();
      } else if (e.target.id === 'cameraInput' && e.target.files && e.target.files[0]) {
        const f = e.target.files[0];
        if (f.size > 5 * 1024 * 1024) {
          showToast('Фото превышает лимит 5 МБ.');
          return;
        }
        state.capturedPhotoUrl = URL.createObjectURL(f);
        showToast('Фото прикреплено: оно останется на устройстве, на сервер уйдёт только гео.');
        render();
      }
    });

    document.getElementById('mainContent').addEventListener('click', async (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const act = el.dataset.action;

      if (act === 'open-map-tab') {
        state.activeTab = el.dataset.tab;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      } else if (act === 'set-vid-filter') {
        state.videoFilter = el.dataset.val;
      } else if (act === 'select-video') {
        state.selectedVideoId = Number(el.dataset.vid);
      } else if (act === 'mark-video-watched') {
        const vid = Number(el.dataset.vid);
        state.watchedVideos[vid] = true;
        showToast(`Ролик №${vid} отмечен как просмотренный ✓`);
      } else if (act === 'set-base-mode') {
        state.baseMode = el.dataset.val;
      } else if (act === 'set-base-filter') {
        state.baseFilter = el.dataset.val;
      } else if (act === 'toggle-prio-post') {
        const num = Number(el.dataset.num);
        const idx = state.bookingPriorities.indexOf(num);
        if (idx === -1) {
          state.bookingPriorities.push(num);
          showToast(`Пост №${num} зафиксирован в заявке как приоритет ${state.bookingPriorities.length} ✓`);
        } else {
          state.bookingPriorities.splice(idx, 1);
          showToast(`Пост №${num} убран из заявки.`);
        }
      } else if (act === 'plan-preset') {
        const val = el.dataset.val;
        if (val === 'clear') {
          state.planBlocks = [];
        } else {
          const count = val === '3m' ? 6 : val === '6m' ? 12 : 24;
          const pattern = (val === 'work2' || val === 'work3') ? val : 'alt';
          state.planBlocks = buildPlanPattern(count, pattern);
        }
        state.planDirty = true;
      } else if (act === 'plan-toggle') {
        const i = Number(el.dataset.idx);
        if (state.planBlocks[i]) {
          state.planBlocks[i].type = state.planBlocks[i].type === 'work' ? 'rest' : 'work';
          state.planBlocks[i].manual = true;
          state.planDirty = true;
        }
      } else if (act === 'save-plan') {
        try {
          const r = await savePlan();
          showToast(r.approved
            ? `План сохранён: ${r.plan_months} мес., +${r.bonus} к приоритету.`
            : 'План сохранён и отправлен на согласование командиру.');
        } catch (err) {
          showToast('План не сохранён: ' + (err && err.message ? err.message : err));
        }
        return;
      } else if (act === 'approve-plan' || act === 'approve-plan-for') {
        // Согласование плана командиром. Без него бонус за горизонт не начисляется.
        const targetId = el.dataset.id ? Number(el.dataset.id) : Number(currentEmployeeId());
        try {
          const r = await stoneApi('approve-watch-plan', { employee_id: targetId });
          if (targetId === Number(currentEmployeeId())) {
            state.planApproved = true;
            state.planApprovedAt = new Date().toISOString();
            state.planMonths = r.plan_months || 0;
          }
          showToast(`План согласован: ${r.plan_months} мес., +${r.bonus} к приоритету.`);
          render();
        } catch (err) {
          showToast('Не удалось согласовать: ' + (err && err.message ? err.message : err));
        }
        return;
      } else if (act === 'submit-booking') {
        if (state.bookingBusy) return;
        if (state.myBooking) {
          showToast('Заявка уже есть — бронировать можно только один раз.');
          return;
        }
        const months = planMonthsFrom(state.planBlocks);
        const horizon = planHorizonCode(months);
        const hLabel = horizon === '1y' ? '1–2 года (+40%)' : horizon === '6m' ? '6 мес (+25%)' : horizon === '3m' ? '3 мес (+10%)' : '1 мес (база)';
        const empId = currentEmployeeId();
        const st = state.staff.find(s => s.id === empId) || state.staff[0] || {};
        const start = anchorOnOrAfter(state.bookingStart || todayIso());
        const end = state.planBlocks.length ? state.planBlocks[0].end : addDaysToIso(nextAnchor(start), -1);
        const prioNums = state.bookingMode === 'any' ? [] : state.bookingPriorities.slice();
        const prios = state.bookingMode === 'any'
          ? ['Вахта (любой пост)']
          : (prioNums.length ? prioNums.map(n => {
              const p = POSTS_LIST.find(x => x.num === n);
              return `№${n} ${p ? p.name : ''}`.trim();
            }) : ['Вахта (любой пост)']);

        // Мгновенная реакция на нажатие: кнопка блокируется, показывается прогресс.
        state.bookingBusy = true;
        render();
        showToast('Отправляю заявку…');
        const t0 = Date.now();

        // План и бронь сохраняются параллельно — ожидание вдвое короче.
        const [planRes, bookRes] = await Promise.allSettled([
          savePlan(),
          cloudCreateBooking(empId, start, end, horizon, state.bookingMode === 'any', prioNums)
        ]);

        const draft = {
          id: Date.now(), staffId: empId, av: st.av || 'nikolay', name: st.name || 'Сотрудник',
          status: st.status || 'reserve_2w', core: Boolean(st.core), horizon: hLabel,
          mode: state.bookingMode, priorities: prios, shiftApproved: false, confirmedPost: '',
          attestationOk: null, score: null
        };

        if (bookRes.status === 'fulfilled') {
          // Заявка видна сразу — не ждём полной перезагрузки get-base (~3.5 c).
          state.applicants.unshift(draft);
          state.activeTab = 'applicants';
          state.bookingBusy = false;
          render();
          const secs = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
          const prioLine = prios.join(', ');
          setLiveBanner(`Заявка принята за ${secs} с · ${hLabel} · ${prioLine}. Сохранено в post_bookings + rotations.`);
          showToast(`Заявка отправлена ✓ ${hLabel} · ${prioLine}`);
          // Фоновая сверка с сервером: подтягивает реальный скоринг и статус аттестации.
          loadCloudData(true).then(() => render()).catch(() => {});
          if (planRes.status === 'rejected') showToast('План не сохранён отдельно — сохраните кнопкой «Сохранить план».');
          return;
        }

        console.warn('Booking write failed:', bookRes.reason);
        state.bookingBusy = false;
        const reason = bookRes.reason || {};
        // Сервер отказал не из-за связи, а потому что заявка уже есть — не показываем
        // ложное «добавлено локально», иначе человек думает, что бронь прошла.
        if (reason.code === 'BOOKING_EXISTS' || /уже есть заявка/i.test(String(reason.message || ''))) {
          showToast('Заявка уже есть — бронировать можно только один раз.');
          await loadCloudData(true).catch(() => {});
          render();
          return;
        }
        state.applicants.unshift(draft);
        state.activeTab = 'applicants';
        render();
        setLiveBanner(`Supabase недоступен: бронь (${hLabel}) добавлена только локально.`);
        showToast('Не удалось записать в Supabase — заявка локальная.');
      } else if (act === 'cancel-booking') {
        const id = Number(el.dataset.id);
        if (!id) return;
        el.disabled = true;
        try {
          await cloudCancelBooking(id);
          showToast('Заявка отменена — можно бронировать заново.');
          await loadCloudData(true);
          render();
        } catch (err) {
          showToast('Не удалось отменить: ' + (err && err.message ? err.message : err));
          el.disabled = false;
        }
        return;
      } else if (act === 'approve-shift') {
        const id = Number(el.dataset.id);
        const app = state.applicants.find(x => x.id === id);
        if (!app) return;
        if (app.rotationId) {
          try {
            await cloudApproveRotation(app.rotationId, false);
            await loadCloudData(true);
            setLiveBanner(`${roleLabel(state.role)} утвердил вахту для ${app.name} (◎) — записано в rotations.`);
            showToast('Шаг 1: вахта утверждена в Supabase (◎).');
            return;
          } catch (err) {
            if (await offerForceOverride(err)) {
              try {
                await cloudApproveRotation(app.rotationId, true);
                await loadCloudData(true);
                showToast('Экстренное утверждение записано в журнал (без аттестации).');
                return;
              } catch (e2) {
                showToast('Не удалось: ' + (e2 && e2.message ? e2.message : e2));
                return;
              }
            }
            console.warn('Approve write failed:', err);
            showToast('Сервер: ' + (err && err.message ? err.message : err));
            return;
          }
        }
        app.shiftApproved = true;
        const st = state.staff.find(s => s.id === app.staffId);
        if (st) {
          st.status = 'approved';
          st.post = 'Уточняется';
          st.postConfirmed = false;
          st.note = `Вахта утв. ${roleLabel(state.role)}, пост ждёт`;
        }
        setLiveBanner(`${roleLabel(state.role)} утвердил вахту для ${app.name} (◎). Локально.`);
        showToast('Шаг 1: вахта утверждена локально (Supabase недоступен).');
      } else if (act === 'confirm-post') {
        const id = Number(el.dataset.id);
        const app = state.applicants.find(x => x.id === id);
        const sel = document.querySelector(`[data-assign-select="${id}"]`);
        const chosenPost = sel ? sel.value : '№1 КПП';
        const numMatch = chosenPost.match(/№(\d+)/);
        const postNum = numMatch ? Number(numMatch[1]) : 1;
        if (!app) return;
        if (app.rotationId) {
          try {
            await cloudConfirmPost(app.rotationId, postNum, false);
            await loadCloudData(true);
            setLiveBanner(`${roleLabel(state.role)} закрепил ${app.name} за постом ${chosenPost} — записано в rotations.`);
            showToast(`Шаг 2: ${app.name} назначен на ${chosenPost} (Supabase).`);
            return;
          } catch (err) {
            if (await offerForceOverride(err)) {
              try {
                await cloudConfirmPost(app.rotationId, postNum, true);
                await loadCloudData(true);
                showToast('Экстренная замена без аттестации записана в журнал.');
                return;
              } catch (e2) {
                showToast('Не удалось: ' + (e2 && e2.message ? e2.message : e2));
                return;
              }
            }
            console.warn('Confirm post write failed:', err);
            showToast('Сервер: ' + (err && err.message ? err.message : err));
            return;
          }
        }
        app.confirmedPost = chosenPost;
        const st = state.staff.find(s => s.id === app.staffId);
        if (st) {
          st.status = 'approved';
          st.post = chosenPost;
          st.postConfirmed = true;
          st.note = `Пост подтверждён (${roleLabel(state.role)})`;
        }
        state.applicants = state.applicants.filter(x => x.id !== id);
        setLiveBanner(`${roleLabel(state.role)} закрепил ${app.name} за постом ${chosenPost}. Локально.`);
        showToast(`Шаг 2: ${app.name} назначен на ${chosenPost} (локально).`);
      } else if (act === 'new-post') {
        openPostModal(null);
        return;
      } else if (act === 'edit-post') {
        const num = Number(el.dataset.num);
        openPostModal(num);
        return;
      } else if (act === 'toggle-post') {
        const num = Number(el.dataset.num);
        const cur = (state.postsAll || []).find(p => p.num === num);
        // isActive === true (активен) → archived (false). Раньше логика была наоборот:
        // кнопка «Архивировать» отправляла is_active:true, поэтому пост оставался в работе.
        const next = cur ? cur.isActive === false : false;
        try {
          await stoneApi('toggle-post', { post_number: num, is_active: next });
          showToast(next ? `Пост №${num} возвращён в работу.` : `Пост №${num} убран в архив.`);
          await loadCloudData(true);
        } catch (err) {
          showToast('Не удалось: ' + (err && err.message ? err.message : err));
        }
        return;
      } else if (act === 'delete-post') {
        const num = Number(el.dataset.num);
        openDeletePostModal(num);
        return;
      } else if (act === 'open-setup-staff') {
        state.setupTab = 'staff';
        document.getElementById('setupModal').classList.remove('hidden');
        renderSetupModal();
        void loadSetupStatus();
        return;
      } else if (act === 'edit-employee') {
        openEmpModal(Number(el.dataset.id));
        return;
      } else if (act === 'att-tab') {
        state.attTab = el.dataset.val;
        if (state.attTab === 'report') void loadAttReport();
      } else if (act === 'study-module') {
        openStudy(el.dataset.slug);
        return;
      } else if (act === 'test-module') {
        startTest(el.dataset.slug);
        return;
      } else if (act === 'ai-send') {
        const input = document.getElementById('aiInput');
        const text = input ? input.value.trim() : '';
        if (input) input.value = '';
        await askAi(text);
        return;
      } else if (act === 'ai-clear') {
        state.aiChat = [];
      } else if (act === 'take-photo') {
        const inp = document.getElementById('cameraInput');
        if (inp) inp.click();
        return;
      } else if (act === 'offline-checkin') {
        await offlineCheckin();
      } else if (act === 'sync-cache') {
        await syncOfflineQueue(false);
      } else if (act === 'test-melody') {
        playFixedNotificationSound(state.selectedMelody);
        showToast('Тест фиксированного сигнала «Стоун Охрана» (6.5 сек)');
        return;
      } else if (act === 'stop-melody') {
        stopNotificationSound();
        showToast('Воспроизведение мелодии остановлено.');
        return;
      } else if (act === 'add-cal-ics') {
        downloadCalendarIcs();
        state.reminderT7Added = true;
        showToast('Файл .ics на дату Т-5д скачан.');
      } else if (act === 'confirm-t5') {
        state.reminderT5Status = 'confirmed';
        setLiveBanner('Подтверждение Т-5д принято: сотрудник выезжает на вахту.');
        showToast('Выезд на вахту подтверждён!');
      } else if (act === 'decline-t5') {
        state.reminderT5Status = 'declined';
        setLiveBanner('⚠️ Отказ на Т-5д: №20, №19 и «Рубеж» получили алерт.');
        showToast('Отказ отправлен старшим смены и «Рубежу».');
      } else if (act === 'geo-checkin') {
        const own = myCurrentPost();
        if (!own) {
          showToast('За вами не закреплён пост — отметку ставит старший смены.');
          return;
        }
        await handleAutoArrival(own.num);
        return;
      }

      render();
    });

    function applyTheme() {
      document.body.dataset.theme = state.bgTheme;
      document.body.dataset.accent = state.accentColor;
      try {
        localStorage.setItem('stone_bg_theme', state.bgTheme);
        localStorage.setItem('stone_accent_color', state.accentColor);
      } catch (_) {}
      document.querySelectorAll('.bg-opt').forEach(b => {
        const active = b.dataset.bg === state.bgTheme;
        b.className = `bg-opt py-2.5 px-3 rounded-xl border text-xs font-medium text-left flex items-center gap-2 transition ${active ? 'border-blue-500 bg-blue-500/15' : 'border-slate-700/70'}`;
      });
      document.querySelectorAll('.acc-opt').forEach(b => {
        const active = b.dataset.acc === state.accentColor;
        b.style.borderColor = active ? '#FFFFFF' : 'transparent';
        b.style.transform = active ? 'scale(1.06)' : 'scale(1)';
      });
    }

    // На диск кладём только локальные настройки. Список сотрудников и заявок —
    // персональные данные: они живут в памяти и приходят с сервера при каждом входе.
    function saveAppState() {
      try {
        localStorage.setItem('stone_wfm_state_v1', JSON.stringify({
          watchedVideos: state.watchedVideos,
          reminderT7Added: state.reminderT7Added,
          reminderT5Status: state.reminderT5Status,
          selectedMelody: state.selectedMelody
        }));
      } catch (_) {}
    }

    try {
      const savedBg = localStorage.getItem('stone_bg_theme');
      const savedAcc = localStorage.getItem('stone_accent_color');
      if (savedBg) state.bgTheme = savedBg;
      if (savedAcc) state.accentColor = savedAcc;
      const rawState = localStorage.getItem('stone_wfm_state_v1');
      if (rawState) {
        const parsed = JSON.parse(rawState);
        if (parsed.watchedVideos) state.watchedVideos = parsed.watchedVideos;
        if (typeof parsed.reminderT7Added === 'boolean') state.reminderT7Added = parsed.reminderT7Added;
        if (parsed.reminderT5Status) state.reminderT5Status = parsed.reminderT5Status;
        if (parsed.selectedMelody) state.selectedMelody = parsed.selectedMelody;
        // Старые сборки писали сюда сотрудников и заявки — вычищаем при первом же запуске.
        if ('staff' in parsed || 'applicants' in parsed) saveAppState();
      }
    } catch (_) {}

    document.getElementById('openThemeModalBtn').addEventListener('click', () => {
      document.getElementById('themeModal').classList.remove('hidden');
      applyTheme();
    });
    document.getElementById('closeThemeModalBtn').addEventListener('click', () => {
      document.getElementById('themeModal').classList.add('hidden');
    });
    document.getElementById('resetLocalStateBtn').addEventListener('click', () => {
      try { localStorage.removeItem('stone_wfm_state_v1'); } catch (_) {}
      location.reload();
    });
    document.getElementById('applyThemeDoneBtn').addEventListener('click', () => {
      document.getElementById('themeModal').classList.add('hidden');
    });
    document.getElementById('bgThemeGroup').addEventListener('click', (e) => {
      const btn = e.target.closest('.bg-opt');
      if (!btn) return;
      state.bgTheme = btn.dataset.bg;
      applyTheme();
      showToast('Фон приложения обновлён.');
    });
    document.getElementById('accentColorGroup').addEventListener('click', (e) => {
      const btn = e.target.closest('.acc-opt');
      if (!btn) return;
      state.accentColor = btn.dataset.acc;
      applyTheme();
      showToast('Цвет кнопок и акцентов обновлён.');
    });

    // Заголовки авторизации: подпись Telegram или веб-сессия
    function authHeaders() {
      const h = Object.assign({}, STONE_API_HEADERS);
      const initData = telegramInitData();
      if (initData) h['x-telegram-init-data'] = initData;
      else if (sessionToken) h['x-stone-session'] = sessionToken;
      return h;
    }

    async function loadCloudData(silent = false) {
      try {
        const res = await fetch(STONE_API_URL + '/get-base', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: '{}'
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

        // Пустой ответ — это тоже ответ: список заменяем всегда, иначе на экране
        // останутся устаревшие (или демонстрационные) люди.
        if (Array.isArray(data.staff)) {
          state.staff = data.staff.map(x => Object.assign({}, x, { avatarUrl: x.avatarUrl || x.avatar_url || '' }));
        }
        if (Array.isArray(data.posts) && data.posts.length) {
          state.postsAll = data.posts.map(p => ({
            id: p.id, num: p.num, name: p.name, shift: p.shift, zone: p.zone,
            lat: p.lat, lon: p.lon, radius: p.radius, offline: p.offline,
            isActive: p.isActive !== false, crew: p.crew || ''
          }));
          POSTS_LIST.length = 0;
          state.postsAll.filter(p => p.isActive !== false).forEach(p => POSTS_LIST.push(p));
        }
        if (Array.isArray(data.applicants)) {
          state.applicants = data.applicants;
        }
        state.myBooking = data.my_booking ?? null;
        if (data.setup) state.setupStatus = data.setup;
        applyPinStatus(data.pin_status);
        if (data.me) {
          state.me = data.me;
          state.authVia = data.via || 'web';
          if (data.me.role) {
            state.role = data.me.role;
          }
        }
        // Конструктор доступен только разработчику
        const cfgBtn = document.getElementById('profileConfigBtn');
        if (cfgBtn) cfgBtn.classList.toggle('hidden', !(data.me && data.me.role === 'developer'));

        state.authOk = true;
        hideAuthGate();
        syncAuthButton();
        syncHeaderAvatar();

        // Конфиг (кэш по версии) и свой годовой план — тихо, без блокировки рендера
        if (state.configVersion !== data.config_version) {
          try {
            const cfg = await stoneApi('get-app-config', {});
            state.config = cfg.config || null;
            state.configVersion = cfg.version || 0;
            if (state.config && state.config.branding_texts && state.config.branding_texts.live_banner) {
              setLiveBanner(state.config.branding_texts.live_banner);
            }
          } catch (_) {}
        }
        try {
          const plan = await stoneApi('get-watch-plan', {});
          state.planBlocks = (plan.blocks || []).map(b => ({
            start: b.block_start_date, end: b.block_end_date,
            type: b.block_type === 'rest' ? 'rest' : 'work',
            manual: Boolean(b.is_manual_override),
            post_number: b.preferred_post_number
          }));
          state.planMonths = plan.plan_months || 0;
          state.planApproved = Boolean(plan.approved);
          state.planApprovedAt = plan.approved_at || null;
        } catch (_) {}

        render();
        // Модалка доступов может быть открыта: список постов должен обновляться
        // вместе с витриной, иначе созданный пост «отстаёт» от матрицы.
        renderSetupModal();
        if (!silent) showToast('Данные загружены из «Стоун Охрана».');
        return true;
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        console.warn('get-base failed:', msg);
        if (/Требуется вход|сессия|Веб-сессия/i.test(msg)) {
          state.authOk = false;
          showAuthGate();
          syncAuthButton();
        } else if (!silent) {
          showToast('Сервер недоступен — локальные данные.');
        }
        return false;
      }
    }

    // --- Telegram initData (Mini App) ---------------------------------------
    function telegramInitData() {
      try { return (tg && tg.initData) ? tg.initData : ''; } catch (_) { return ''; }
    }

    // 1. Авторизация через Edge Function /auth-telegram (HMAC-SHA256 на сервере)
    async function stoneAuthTelegram() {
      const initData = telegramInitData();
      if (!initData) {
        state.tgAuth = { status: 'no_init_data' };
        return null;
      }
      try {
        const res = await fetch(STONE_API_URL + '/auth-telegram', {
          method: 'POST',
          headers: Object.assign({ 'x-telegram-init-data': initData }, STONE_API_HEADERS)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

        state.tgAuth = { status: 'ok', employee: data.employee };
        state.cloudEmployeeId = data.employee.id;
        state.me = data.employee;
        syncHeaderAvatar();
        if (data.employee.role) {
          state.role = data.employee.role;
        }
        render();
        showToast(`Вход через Telegram: ${data.employee.full_name} · ${roleLabel(data.employee.role)}`);
        return data.employee;
      } catch (err) {
        state.tgAuth = { status: 'error', message: String(err && err.message ? err.message : err) };
        console.warn('Telegram auth failed:', err);
        showToast('Telegram-авторизация: ' + state.tgAuth.message);
        return null;
      }
    }

    // 2. Реальная геопозиция браузера / Telegram WebView
    function getGeoPosition() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        const timer = setTimeout(() => resolve(null), 12000);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer);
            resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) });
          },
          () => { clearTimeout(timer); resolve(null); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    }

    // 3. Серверная проверка радиуса через Edge Function /checkin-150m
    async function stoneCheckin150m(postNumber, coords) {
      const post = POSTS_LIST.find(p => p.num === postNumber);
      if (!post || !post.id) throw new Error('Пост не найден в базе');
      // Метод не отправляем: сервер сам решит, авто это или QR.
      // Идём через общий stoneApi, а не сырым fetch: иначе веб-сессия (вход по
      // коду без Telegram) не могла поставить GPS-отметку — запрос уходил без
      // заголовка сессии и получал 401.
      return stoneApi('checkin-150m', {
        post_id: post.id,
        rotation_id: null,
        lat: coords ? coords.lat : null,
        lon: coords ? coords.lon : null
      });
    }

    // Авто-прибытие: сервер проверяет GPS. Если сервер отказал — отметки нет.
    async function handleAutoArrival(postNumber) {
      const geoText = document.getElementById('geoStatusText');
      if (geoText) geoText.textContent = 'определяю…';
      const coords = await getGeoPosition();
      if (!coords) {
        if (geoText) geoText.textContent = 'нет доступа';
        showToast('Геопозиция недоступна. Разрешите доступ в браузере.');
        return;
      }
      try {
        const r = await stoneCheckin150m(postNumber, coords);
        setLiveBanner(r.auto_arrived
          ? `Сервер подтвердил прибытие: ${r.distance_m} м до поста → «На вахте (✓)»`
          : `Сервер зафиксировал отметку без GPS (пост без координат) → «На вахте (✓)»`);
        showToast('Прибытие подтверждено сервером (stone-api).');
        await loadCloudData(true);
        return;
      } catch (err) {
        if (err && err.status) {
          // Отказ по существу: вне радиуса или нет координат. Локальную «победную»
          // запись не создаём — иначе контроль присутствия обходится.
          if (geoText) geoText.textContent = 'не подтверждено';
          showToast('Прибытие не подтверждено: ' + (err.message || err.status));
          return;
        }
        console.warn('stone-api checkin-150m:', err);
      }
      // Сеть недоступна. Оффлайн-запись допустима только там, где она разрешена
      // постом: иначе это был бы обход геозоны «по факту обрыва связи» (F1).
      const post = allPosts().find(x => Number(x.num) === Number(postNumber));
      if (!post || !post.offline) {
        if (geoText) geoText.textContent = 'нет сети';
        showToast('Нет связи с сервером — отметка не записана. Повторите, когда появится сеть.');
        return;
      }
      const at = new Date().toISOString();
      const queued = queueOfflineCheckin(Number(postNumber), at, 'qr');
      render();
      // Дубликат (та же отметка в пределах минуты) не добавляется — и не врём про «сохранено».
      showToast(queued
        ? 'Нет сети: отметка сохранена на устройстве. Отправим при связи.'
        : 'Такая отметка уже в очереди — второй раз не записываю.');
    }

    // Единая точка записи: всё идёт через Edge Function, где личность берётся из подписи Telegram
    async function stoneApi(action, body) {
      if (!telegramInitData() && !sessionToken) {
        showAuthGate();
        throw new Error('Нужен вход: откройте бота или подтвердите вход в веб-панель');
      }
      const res = await fetch(STONE_API_URL + '/' + action, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body || {})
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) {
        if (res.status === 401) {
          // Токен просрочен или отозван: локальные копии данных тоже не оставляем.
          sessionToken = '';
          try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
          state.authOk = false;
          state.me = null;
          state.staff = [];
          state.applicants = [];
          state.myBooking = null;
          showAuthGate();
          syncAuthButton();
        }
        const e = new Error(data.error || ('HTTP ' + res.status));
        e.status = res.status;
        e.code = data.code;
        e.hint = data.hint;
        throw e;
      }
      return data;
    }

    // --- Админ-настройка объектов -------------------------------------------
    async function cloudSetPostCoords(postNumber, lat, lon, radius) {
      return stoneApi('set-coords', {
        post_number: postNumber,
        lat: lat == null ? null : lat,
        lon: lon == null ? null : lon,
        radius_m: radius == null ? null : radius
      });
    }

    async function cloudSetEmployeeTelegram(employeeId, telegramId) {
      return stoneApi('set-telegram', { employee_id: employeeId, telegram_id: telegramId });
    }

    // --- Коды входа без Telegram (только для старших смены) -----------------
    const MANAGER_ROLES = ['chief', 'senior_20', 'senior_19_night', 'developer'];

    function isManagerRole() {
      const r = state.me && state.me.role;
      return !!r && MANAGER_ROLES.indexOf(r) !== -1;
    }

    // Сервер отдаёт статус кодов только менеджеру: id -> {has_pin, phone_masked, locked}
    function applyPinStatus(rows) {
      if (!Array.isArray(rows)) return;
      const map = {};
      rows.forEach(p => { if (p && p.id != null) map[p.id] = p; });
      state.pinStatus = map;
    }

    async function loadSetupStatus() {
      try {
        const res = await fetch(STONE_API_URL + '/get-base', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: '{}'
        });
        const data = await res.json();
        if (res.ok && data.setup) state.setupStatus = data.setup;
        if (res.ok) applyPinStatus(data.pin_status);
      } catch (err) {
        console.warn('setup status failed:', err);
      }
      renderSetupModal();
    }

    function setupTabClass(active) {
      return active
        ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
        : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800';
    }

    function renderSetupModal() {
      const body = document.getElementById('setupBody');
      if (!body) return;
      const st = state.setupStatus;
      const manager = isManagerRole();
      if (state.setupTab === 'pin' && !manager) state.setupTab = 'posts';

      document.querySelectorAll('.setup-tab').forEach(btn => {
        const hide = btn.dataset.setupTab === 'pin' && !manager;
        btn.className = 'setup-tab flex-1 py-2 rounded-lg text-[11px] font-medium border transition ' +
          (hide ? 'hidden ' : '') + setupTabClass(btn.dataset.setupTab === state.setupTab);
      });

      const summary = document.getElementById('setupSummary');
      if (summary) {
        // Посты без координат — не косметика: на них «прибытие» подтверждается
        // самим сотрудником. Держим счётчик в шапке, а не только внутри вкладки.
        const noGeoCount = allPosts().filter(p => p.isActive !== false && (p.lat == null || p.lon == null)).length;
        const base = st
          ? `Координаты постов: ${st.postsWithCoords}/${st.postsTotal} · Telegram ID: ${st.staffLinked}/${st.staffTotal}${noGeoCount ? ` · без GPS: ${noGeoCount}` : ''}`
          : 'Статус недоступен (нет связи с Supabase)';
        const withPin = Object.keys(state.pinStatus).filter(k => state.pinStatus[k].has_pin).length;
        summary.textContent = manager ? `${base} · Коды: ${withPin}` : base;
      }

      const hint = document.getElementById('setupHint');
      if (hint) {
        if (state.setupTab === 'pin') {
          hint.textContent = 'Код из 6 цифр — разовый пропуск для входа в Chrome без Telegram. Хранится только хэш: показанный код восстановить нельзя, можно лишь выдать новый.';
        } else if (telegramInitData()) {
          hint.textContent = 'Координаты нужны для авто-прибытия в радиусе 150 м. Встаньте у поста и нажмите «Мои координаты» — широта и долгота подставятся автоматически.';
        } else {
          hint.textContent = 'Вход выполнен по веб-сессии. Изменения сохраняются на сервере под вашей ролью.';
        }
      }

      if (state.setupTab === 'posts') {
        // Посты без координат не могут подтвердить прибытие автоматически — предупреждаем сразу.
        const noGeo = allPosts().filter(p => p.isActive !== false && (p.lat == null || p.lon == null));
        const geoWarn = noGeo.length
          ? `<div class="mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] leading-snug">
               Без координат: ${noGeo.length} ${noGeo.length === 1 ? 'пост' : 'постов'} (${noGeo.map(p => '№' + p.num).join(', ')}).
               Авто-прибытие в радиусе 150 м для них не сработает — встаньте у поста и нажмите «📍 Мои координаты».
             </div>`
          : '';
        body.innerHTML = geoWarn + allPosts().map(p => {
          const has = p.lat != null && p.lon != null;
          const archived = p.isActive === false;
          return `
            <div class="rounded-xl border ${has ? 'border-emerald-600/40' : 'border-slate-700/80'} bg-slate-900/60 p-2.5 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="font-medium text-slate-100 truncate">№${p.num} ${escHtml(p.name)}${archived ? ' <span class="text-[10px] text-slate-500">· в архиве</span>' : ''}</div>
                <div class="text-[10px] shrink-0 ${has ? 'text-emerald-400' : 'text-amber-400'}">${has ? '✓ GPS' : 'нет GPS'}</div>
              </div>
              <div class="flex items-center gap-1.5">
                <input id="setupLat${p.num}" type="number" step="0.000001" inputmode="decimal" placeholder="широта" value="${has ? p.lat : ''}" class="w-0 flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-100 placeholder:text-slate-600" />
                <input id="setupLon${p.num}" type="number" step="0.000001" inputmode="decimal" placeholder="долгота" value="${has ? p.lon : ''}" class="w-0 flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-100 placeholder:text-slate-600" />
              </div>
              <div class="flex gap-1.5">
                <button type="button" data-geo-post="${p.num}" class="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-200">📍 Мои координаты</button>
                <button type="button" data-save-post="${p.num}" class="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[10px] font-semibold text-white">Сохранить</button>
                ${has ? `<button type="button" data-clear-post="${p.num}" class="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/30 border border-slate-700 text-[10px] text-slate-300">✕</button>` : ''}
              </div>
            </div>`;
        }).join('');
        return;
      }

      if (state.setupTab === 'pin') {
        if (!manager) {
          body.innerHTML = `<div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">Выдавать коды входа может только старший смены или руководство.</div>`;
          return;
        }
        body.innerHTML = renderPinTab();
        return;
      }

      const unlinked = state.staff.filter(s => !s.tgLinked);
      const rows = state.showAllStaff ? state.staff : unlinked;
      if (!rows.length) {
        body.innerHTML = `<div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px]">Все сотрудники привязаны к Telegram.</div>`;
        return;
      }
      body.innerHTML = `
        <div class="flex items-center justify-between pb-1">
          <span class="text-[10px] th-muted">Без привязки: ${unlinked.length}</span>
          <button type="button" data-toggle-staff class="text-[10px] text-blue-300 underline">${state.showAllStaff ? 'только без ID' : 'показать всех'}</button>
        </div>
        ${rows.map(s => `
          <div class="rounded-xl border ${s.tgLinked ? 'border-emerald-600/40' : 'border-slate-700/80'} bg-slate-900/60 p-2.5 flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-medium text-slate-100 truncate">${escHtml(s.name)}</div>
              <div class="text-[10px] th-muted truncate">${escHtml(s.post || 'Резерв')}</div>
            </div>
            <input id="setupTg${s.id}" type="text" inputmode="numeric" placeholder="Telegram ID" class="w-24 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-100 placeholder:text-slate-600" />
            <button type="button" data-save-tg="${s.id}" class="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[10px] font-semibold text-white shrink-0">OK</button>
          </div>`).join('')}`;
    }

    // Коды входа без Telegram: список сотрудников + выдача/отзыв
    function renderPinTab() {
      const issued = state.lastPin;
      const issuedHtml = issued ? `
        <div class="rounded-xl border border-emerald-600/40 bg-emerald-500/10 p-3 space-y-2">
          <div class="text-[10px] text-emerald-300">Код для ${escHtml(issued.name)} — показан один раз</div>
          <div class="flex items-center gap-2">
            <div class="text-xl font-bold tracking-[0.28em] tabular-nums text-emerald-200">${issued.pin}</div>
            <button type="button" data-copy-pin="${issued.pin}" class="ml-auto px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-200 shrink-0">Скопировать</button>
          </div>
          <div class="text-[10px] th-muted">${issued.phone || ''} · передайте сотруднику лично. После «Отозвать» код не действует.</div>
        </div>` : '';

      const rows = state.staff.map(s => {
        const p = state.pinStatus[s.id] || {};
        const has = !!p.has_pin;
        return `
          <div class="rounded-xl border ${has ? 'border-emerald-600/40' : 'border-slate-700/80'} bg-slate-900/60 p-2.5 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium text-slate-100 truncate">${escHtml(s.name)}</div>
                <div class="text-[10px] th-muted truncate">${escHtml(s.post || 'Резерв')}</div>
              </div>
              <div class="text-[10px] shrink-0 ${has ? 'text-emerald-400' : 'th-muted'}">${has ? (p.locked ? 'заблокирован' : 'код выдан') : 'нет кода'}</div>
            </div>
            ${has ? `
              <div class="flex items-center gap-1.5">
                <div class="flex-1 min-w-0 text-[11px] text-slate-300 truncate tabular-nums">${p.phone_masked || '—'}</div>
                <button type="button" data-revoke-pin="${s.id}" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/30 border border-slate-700 text-[10px] text-slate-300 shrink-0">Отозвать</button>
              </div>` : `
              <div class="flex items-center gap-1.5">
                <input id="setupPinPhone${s.id}" type="tel" inputmode="tel" placeholder="+7 999 123-45-67" class="w-0 flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-100 placeholder:text-slate-600" />
                <button type="button" data-issue-pin="${s.id}" class="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[10px] font-semibold text-white shrink-0">Выдать код</button>
              </div>`}
          </div>`;
      }).join('');

      return issuedHtml +
        `<div class="text-[10px] th-muted pb-1">Сотрудников: ${state.staff.length}</div>` + rows;
    }

    function currentEmployeeId() {
      if (state.cloudEmployeeId) return state.cloudEmployeeId;
      if (state.role === 'senior_20') return 1;
      if (state.role === 'senior_19_night') return 2;
      if (state.role === 'monitor_10') return 13;
      if (state.role === 'chief') return 4;
      if (state.role === 'developer') return 12;
      return 16;
    }

    function addDaysIso(dateStr, days) {
      const d = new Date((dateStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }

    function bookingStatusLabel(status) {
      const map = {
        open: 'открыта',
        shift_approved: 'вахта утверждена',
        post_confirmed: 'пост подтверждён',
        cancelled: 'отменена'
      };
      return map[status] || String(status || 'открыта');
    }

    async function cloudCreateBooking(employeeId, start, end, horizon, anyPost, priorityNums) {
      return stoneApi('create-booking', {
        start: start,
        end: end,
        horizon: horizon,
        any_post: anyPost,
        priority_posts: priorityNums
      });
    }

    async function cloudCancelBooking(bookingId) {
      return stoneApi('cancel-booking', { booking_id: bookingId });
    }

    async function cloudApproveRotation(rotationId, force) {
      return stoneApi('approve-rotation', { rotation_id: rotationId, force_override: Boolean(force) });
    }

    async function cloudConfirmPost(rotationId, postNumber, force) {
      return stoneApi('confirm-post', { rotation_id: rotationId, post_number: postNumber, force_override: Boolean(force) });
    }

    // Отметка без GPS. Расстояние и признак авто клиент не передаёт —
    // сервер их не принимает и выводит сам.
    // Ошибку НЕ глушим: вызывающий код обязан знать, записалась отметка или нет.
    async function cloudCreateCheckin(postNumber, method, offline, clientAt) {
      return stoneApi('checkin', {
        post_number: postNumber,
        method: method || 'qr',
        offline: Boolean(offline),
        client_at: clientAt || null
      });
    }

    // --- Оффлайн-отметки: настоящая очередь, а не счётчик в памяти -----------
    // Раньше кнопка «Оффлайн-кэш» слала отметку на пост №4, глотала ошибку и
    // показывала «сохранено в кэш», хотя кэша не было. Теперь: отметку можно
    // ставить только на свой пост из оффлайн-зоны, при обрыве сети она кладётся
    // в localStorage с временем устройства и уходит на сервер при связи.
    //
    // M1 четвёртого аудита: в записи не было владельца, поэтому на общем постовом
    // планшете отметка уходила от имени следующего вошедшего. Теперь у каждой
    // записи есть employee_id, синхронизируются только свои, а logout чистит ключ.
    const OFFLINE_KEY = 'stone_offline_queue_v1';

    function loadOfflineQueue() {
      try {
        const raw = localStorage.getItem(OFFLINE_KEY);
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr)
          ? arr.filter(x => x && Number(x.post_number) > 0).map(x => ({
              post_number: Number(x.post_number),
              at: String(x.at || new Date().toISOString()),
              method: x.method === 'nfc' ? 'nfc' : 'qr',
              employee_id: x.employee_id != null ? Number(x.employee_id) : null
            }))
          : [];
      } catch (_) { return []; }
    }

    function saveOfflineQueue() {
      try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(state.offlineQueue)); } catch (_) {}
    }

    function clearOfflineQueue() {
      state.offlineQueue = [];
      try { localStorage.removeItem(OFFLINE_KEY); } catch (_) {}
    }

    // Записи текущего сотрудника. Чужие остаются в хранилище: их владелец
    // досылает сам, когда вернётся на это устройство.
    function myQueue() {
      const me = Number(currentEmployeeId());
      return state.offlineQueue.filter(x => Number(x.employee_id) === me);
    }

    function foreignQueueCount() {
      const me = Number(currentEmployeeId());
      return state.offlineQueue.filter(x => Number(x.employee_id) !== me).length;
    }

    // Кладём в очередь с дедупликацией: повторное нажатие в течение минуты
    // не создаёт вторую отметку на том же посту (L11).
    function queueOfflineCheckin(postNumber, at, method) {
      const me = Number(currentEmployeeId());
      const num = Number(postNumber);
      const t = new Date(at).getTime();
      const dup = state.offlineQueue.some(x =>
        Number(x.employee_id) === me &&
        Number(x.post_number) === num &&
        Math.abs(new Date(x.at).getTime() - t) < 60000
      );
      if (dup) return false;
      state.offlineQueue.push({
        post_number: num,
        at: String(at),
        method: method === 'nfc' ? 'nfc' : 'qr',
        employee_id: me
      });
      saveOfflineQueue();
      return true;
    }

    // Мой закреплённый пост — единственный, на котором сервер примет отметку
    // (находка H1). Раньше кнопка GPS-прибытия была прибита к посту №1,
    // поэтому у остальных охранников она либо молчала, либо била не туда.
    function myCurrentPost() {
      const me = state.staff.find(s => Number(s.id) === Number(currentEmployeeId()));
      if (!me || !me.currentPostNumber) return null;
      return allPosts().find(x => Number(x.num) === Number(me.currentPostNumber)) || null;
    }

    // Мой текущий пост — и только если он объявлен оффлайн-зоной.
    function myOfflinePost() {
      const p = myCurrentPost();
      return p && p.offline ? p : null;
    }

    // Отправка очереди. Возвращает { sent, left, dropped }.
    async function syncOfflineQueue(silent) {
      const own = myQueue();
      if (!own.length) {
        if (!silent) {
          showToast(foreignQueueCount()
            ? 'На устройстве есть отметки другого сотрудника — отправит он сам.'
            : 'Кэш пуст — все отметки уже на сервере.');
        }
        return { sent: 0, left: 0, dropped: 0 };
      }
      const me = Number(currentEmployeeId());
      let sent = 0, dropped = 0;
      const rest = [];
      for (const item of state.offlineQueue.slice()) {
        if (Number(item.employee_id) !== me) { rest.push(item); continue; }
        try {
          await cloudCreateCheckin(item.post_number, item.method, true, item.at);
          sent++;
        } catch (err) {
          // Отказ по существу (пост больше не оффлайн, отметка старше суток,
          // время из будущего) — держать такую запись бессмысленно. А вот 401
          // (сессия истекла) и 429 (лимит) — не повод терять отметку: оставляем.
          const code = err && err.status;
          const semantic = code === 400 || code === 403 || code === 404 || code === 409 || code === 410 || code === 413;
          if (semantic) {
            dropped++;
            continue;
          }
          rest.push(item);
        }
      }
      state.offlineQueue = rest;
      saveOfflineQueue();
      render();
      if (!silent) {
        showToast(`Синхронизация: отправлено ${sent}, осталось ${myQueue().length}${dropped ? `, отклонено ${dropped}` : ''}.`);
      }
      return { sent, left: myQueue().length, dropped };
    }

    // Поставить оффлайн-отметку: сразу в сеть, при обрыве — в очередь.
    async function offlineCheckin() {
      const post = myOfflinePost();
      if (!post) {
        showToast('Оффлайн-отметка доступна только на вашем посте из оффлайн-зоны.');
        return;
      }
      const at = new Date().toISOString();
      try {
        await cloudCreateCheckin(post.num, 'qr', true, at);
        showToast(`Отметка на посту №${post.num} записана на сервере.`);
        await loadCloudData(true);
      } catch (err) {
        // 401 (сессия истекла) и 5xx — не повод терять отметку: сохраняем и
        // отправим после повторного входа. По существу сервер отказывает 400/403.
        if (err && err.status && err.status !== 401 && err.status < 500) {
          showToast('Сервер отказал: ' + (err.message || err.status));
          return;
        }
        const queued = queueOfflineCheckin(post.num, at, 'qr');
        render();
        if (!queued) {
          showToast('Такая отметка уже в очереди — второй раз не записываю.');
        } else {
          showToast(err && err.status === 401
            ? 'Сессия истекла: отметка сохранена на устройстве. Войдите заново — отправим.'
            : 'Нет сети: отметка сохранена на устройстве. Отправим, когда появится связь.');
        }
      }
    }

    // -----------------------------------------------------------------------
    // Этап 1–3: матрица постов, ручные правки сотрудника, годовой план
    // -----------------------------------------------------------------------
    async function savePlan() {
      const r = await stoneApi('save-watch-plan', {
        blocks: state.planBlocks.map(b => ({ start: b.start, end: b.end, type: b.type, manual: Boolean(b.manual) }))
      });
      state.planMonths = r.plan_months;
      // Охранник сохраняет план «на согласование», командир — сразу с подтверждением.
      state.planApproved = Boolean(r.approved);
      state.planApprovedAt = r.approved ? new Date().toISOString() : null;
      state.planDirty = false;
      return r;
    }

    // 409 ATTESTATION_REQUIRED: командир может провести экстренную замену с записью в журнал
    async function offerForceOverride(err) {
      const msg = String(err && err.message ? err.message : err);
      if (!/допуск|модул|аттестац/i.test(msg)) return false;
      return window.confirm(`${msg}\n\nПровести экстренную замену без аттестации?\nДействие попадёт в журнал audit_logs.`);
    }

    function openDeletePostModal(num) {
      const post = (state.postsAll || []).find(p => p.num === num);
      document.getElementById('deletePostLabel').textContent = `№${num}${post?.name ? ' «' + post.name + '»' : ''}`;
      const btn = document.getElementById('confirmDeletePostBtn');
      if (btn) btn.dataset.num = String(num);
      const pin = document.getElementById('deletePostPin');
      if (pin) pin.value = '';
      document.getElementById('deletePostModal').classList.remove('hidden');
      setTimeout(() => pin?.focus(), 50);
    }

    function openPostModal(num) {
      const existing = num != null ? (state.postsAll || []).find(p => p.num === num) : null;
      state.postEditor = { num: existing ? existing.num : null };
      document.getElementById('postModalTitle').textContent = existing ? `Пост №${existing.num}` : 'Новый пост';
      const shifts = [
        ['08:00-20:00 / 20:00-08:00', '08–20 / 20–08'],
        ['02:00-14:00 / 14:00-02:00', '02–14 / 14–02'],
        ['14:00-02:00 / 02:00-14:00', '14–02 / 02–14'],
        ['08:00-20:00', '08–20'],
        ['20:00-08:00', '20–08']
      ];
      const zones = [['street', 'улица'], ['lobby', 'лобби'], ['parking', 'паркинг'], ['monitor', 'мониторная'], ['unloading', 'разгрузка']];
      const nextNum = Math.max(0, ...(state.postsAll || []).map(p => Number(p.num) || 0)) + 1;
      const body = document.getElementById('postModalBody');
      body.innerHTML = `
        <label class="block">
          <span class="text-[10px] th-muted">Номер поста</span>
          <input id="postNumInput" type="number" inputmode="numeric" min="1" max="999" ${existing ? 'disabled' : ''} value="${existing ? existing.num : nextNum}" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 disabled:opacity-60" />
          <span class="text-[10px] text-slate-500">№19 и №20 системные — их нельзя создать заново.</span>
        </label>
        <label class="block">
          <span class="text-[10px] th-muted">Название</span>
          <input id="postNameInput" type="text" maxlength="60" value="${existing ? String(existing.name).replace(/"/g, '&quot;') : ''}" placeholder="Например: Секция 4" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100" />
        </label>
        <label class="block">
          <span class="text-[10px] th-muted">График</span>
          <select id="postShiftSelect" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100">
            ${shifts.map(([v, l]) => `<option value="${v}" ${existing && existing.shift === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="block">
          <span class="text-[10px] th-muted">Зона</span>
          <select id="postZoneSelect" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100">
            ${zones.map(([v, l]) => `<option value="${v}" ${existing && (existing.zone === v || (v === 'parking' && existing.zone === 'underground') || (v === 'street' && existing.zone === 'ground') || (v === 'monitor' && existing.zone === 'command')) ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
          <input id="postOfflineInput" type="checkbox" ${existing && existing.offline ? 'checked' : ''} class="w-4 h-4 accent-blue-600" />
          <span class="text-[11px] text-slate-300">Offline-First (подземные №4 / №12: чекин копится в кэш)</span>
        </label>
        <button type="button" id="savePostBtn" class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white">
          ${existing ? 'Сохранить пост' : 'Создать пост'}
        </button>
        <p class="text-[10px] text-slate-500">Изменения сразу уходят в Supabase и пишутся в audit_logs.</p>
      `;
      document.getElementById('postModal').classList.remove('hidden');
      document.getElementById('savePostBtn').onclick = savePost;
    }

    async function savePost() {
      const btn = document.getElementById('savePostBtn');
      const editing = state.postEditor && state.postEditor.num != null;
      const num = editing ? state.postEditor.num : Number(document.getElementById('postNumInput').value);
      const name = document.getElementById('postNameInput').value.trim();
      const shift = document.getElementById('postShiftSelect').value;
      const zone = document.getElementById('postZoneSelect').value;
      const offline = document.getElementById('postOfflineInput').checked;
      if (!num || name.length < 2) { showToast('Укажите номер и название поста.'); return; }
      btn.disabled = true;
      btn.textContent = 'Сохраняю…';
      try {
        if (editing) await stoneApi('update-post', { post_number: num, name, shift, zone, offline });
        else await stoneApi('create-post', { post_number: num, name, shift, zone, offline });
        document.getElementById('postModal').classList.add('hidden');
        showToast(editing ? `Пост №${num} обновлён.` : `Пост №${num} создан.`);
        await loadCloudData(true);
      } catch (err) {
        showToast('Не сохранено: ' + (err && err.message ? err.message : err));
      } finally {
        btn.disabled = false;
        btn.textContent = editing ? 'Сохранить пост' : 'Создать пост';
      }
    }

    // --- Ручное редактирование сотрудника / замена поста (этап 3) ----------
    function openEmpModal(id) {
      const s = state.staff.find(x => Number(x.id) === Number(id));
      if (!s) { showToast('Сотрудник не найден.'); return; }
      state.empEditor = { id: s.id };
      const topRole = ['chief', 'developer'].includes(state.role);
      const posts = (state.postsAll || POSTS_LIST).filter(p => p.isActive !== false);
      const readiness = [
        ['on_watch', 'На вахте'], ['approved', 'Утверждён'],
        ['reserve_2w', 'Резерв 2 нед.'], ['reserve_1m', 'Резерв до мес.'], ['reserve_long', 'Более месяца']
      ];
      const roles = [
        ['guard', 'Охранник'], ['monitor_10', '№10 Мониторная'], ['senior_20', '№20 Старший день'],
        ['senior_19_night', '№19 Старший ночь'], ['chief', '«Рубеж» (chief)'], ['developer', 'Разработчик']
      ];
      document.getElementById('empModalTitle').textContent = s.name;
      document.getElementById('empModalBody').innerHTML = `
        <label class="block">
          <span class="text-[10px] th-muted">Имя / позывной</span>
          <input id="empNameInput" type="text" maxlength="80" value="${String(s.name).replace(/"/g, '&quot;')}" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100" />
        </label>
        <label class="block">
          <span class="text-[10px] th-muted">Текущий пост</span>
          <select id="empPostSelect" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100">
            <option value="">Не закреплён (Резерв)</option>
            ${posts.map(p => `<option value="${p.num}" ${Number(s.currentPostNumber) === Number(p.num) ? 'selected' : ''}>№${p.num} ${escHtml(p.name)}</option>`).join('')}
          </select>
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-[10px] th-muted">Статус</span>
            <select id="empStatusSelect" class="mt-1 w-full px-2 py-2 rounded-xl bg-slate-950 border border-slate-700 text-[11px] text-slate-100">
              ${readiness.map(([v, l]) => `<option value="${v}" ${s.status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label class="block">
            <span class="text-[10px] th-muted">Смена</span>
            <select id="empShiftSelect" class="mt-1 w-full px-2 py-2 rounded-xl bg-slate-950 border border-slate-700 text-[11px] text-slate-100">
              <option value="" ${!s.shiftCode ? 'selected' : ''}>—</option>
              <option value="day" ${s.shiftCode === 'day' ? 'selected' : ''}>день</option>
              <option value="night" ${s.shiftCode === 'night' ? 'selected' : ''}>ночь</option>
            </select>
          </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-[10px] th-muted">Дисциплина (−60…+30)</span>
            <input id="empDiscInput" type="number" min="-60" max="30" value="${Number(s.discipline || 0)}" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 tabular-nums" />
          </label>
          <label class="flex items-center gap-2 mt-4 p-2 rounded-xl bg-slate-950 border border-slate-800">
            <input id="empCoreInput" type="checkbox" ${s.core ? 'checked' : ''} class="w-4 h-4 accent-emerald-600" />
            <span class="text-[11px] text-slate-300">Костяк</span>
          </label>
        </div>
        <label class="block">
          <span class="text-[10px] th-muted">Роль ${topRole ? '' : '(менять может только «Рубеж» и Разработчик)'}</span>
          <select id="empRoleSelect" ${topRole ? '' : 'disabled'} class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 disabled:opacity-50">
            ${roles.map(([v, l]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="block">
          <span class="text-[10px] th-muted">Примечание</span>
          <input id="empNoteInput" type="text" maxlength="200" value="${String(s.note || '').replace(/"/g, '&quot;')}" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100" />
        </label>
        <div class="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400 leading-relaxed">
          Допуск: ${s.attestationOk ? '✓ сдан' : '⚠ не сдан'} ${(s.missingModules || []).map(m => escHtml(m.title)).join(', ')}
          · План: ${s.planMonths || 0} мес.
        </div>
        <label class="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <input id="empForceInput" type="checkbox" class="w-4 h-4 accent-amber-500" />
          <span class="text-[10px] text-amber-200">Экстренная замена без аттестации (запись в audit_logs)</span>
        </label>
        <button type="button" id="saveEmpBtn" class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white">Сохранить</button>
      `;
      document.getElementById('empModal').classList.remove('hidden');
      document.getElementById('saveEmpBtn').onclick = () => saveEmployee();
    }

    async function saveEmployee() {
      const id = state.empEditor && state.empEditor.id;
      if (!id) return;
      const btn = document.getElementById('saveEmpBtn');
      const postVal = document.getElementById('empPostSelect').value;
      const body = {
        employee_id: id,
        full_name: document.getElementById('empNameInput').value.trim(),
        current_post_number: postVal === '' ? null : Number(postVal),
        readiness_status: document.getElementById('empStatusSelect').value,
        shift_code: document.getElementById('empShiftSelect').value || null,
        discipline_score: Number(document.getElementById('empDiscInput').value || 0),
        is_core: document.getElementById('empCoreInput').checked,
        note: document.getElementById('empNoteInput').value.trim(),
        force_override: document.getElementById('empForceInput').checked,
        reason: 'Ручная правка из карточки сотрудника'
      };
      const roleSel = document.getElementById('empRoleSelect');
      if (roleSel && !roleSel.disabled) body.role = roleSel.value;
      btn.disabled = true;
      btn.textContent = 'Сохраняю…';
      try {
        await stoneApi('update-employee', body);
        document.getElementById('empModal').classList.add('hidden');
        showToast('Изменения сохранены и записаны в журнал.');
        await loadCloudData(true);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (/допуск|модул|аттестац/i.test(msg) && !body.force_override) {
          showToast('Нужен допуск: отметьте «Экстренная замена» и сохраните снова.');
          const cb = document.getElementById('empForceInput');
          if (cb) cb.checked = true;
        } else {
          showToast('Не сохранено: ' + msg);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить';
      }
    }

    // -----------------------------------------------------------------------
    // Этап 4: конструктор приложения (developer + ПИН)
    // -----------------------------------------------------------------------
    async function openConfigModal() {
      if (!state.me || state.me.role !== 'developer') { showToast('Конструктор доступен только роли developer.'); return; }
      if (!state.config) {
        try {
          const r = await stoneApi('get-app-config', {});
          state.config = r.config || {};
          state.configVersion = r.version || 0;
        } catch (err) {
          showToast('Конфиг недоступен: ' + (err && err.message ? err.message : err));
          return;
        }
      }
      state.configDraft = JSON.parse(JSON.stringify(state.config));
      state.configDirty = false;
      renderConfigModal();
      document.getElementById('configModal').classList.remove('hidden');
    }

    function renderConfigModal() {
      document.getElementById('configVersionLabel').textContent = `Версия конфига: ${state.configVersion}`;
      document.getElementById('configDraftBanner').classList.toggle('hidden', !state.configDirty);
      const draft = state.configDraft || {};
      document.getElementById('configModalBody').innerHTML = `
        ${Object.keys(draft).map(k => `
          <label class="block">
            <span class="text-[10px] th-muted">${k}</span>
            <textarea data-cfg-key="${k}" rows="4" class="mt-1 w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-[10px] font-mono text-slate-100 outline-none">${JSON.stringify(draft[k], null, 2).replace(/</g, '&lt;')}</textarea>
          </label>
        `).join('')}
        <label class="block">
          <span class="text-[10px] th-muted">ПИН конструктора</span>
          <input id="configPinInput" type="password" inputmode="numeric" maxlength="8" placeholder="••••" class="mt-1 w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-center text-sm tracking-[0.3em] text-slate-100" />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="previewConfigBtn" class="py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200">Предпросмотр</button>
          <button type="button" id="saveConfigBtn" class="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white">Закрепить и синхронизировать</button>
        </div>
        <p class="text-[10px] text-slate-500 leading-relaxed">
          Правки применяются локально до нажатия «Закрепить». Сервер проверит ПИН и версию, запишет историю в config_audit_logs.
        </p>
      `;
      document.querySelectorAll('[data-cfg-key]').forEach(ta => {
        ta.addEventListener('input', () => {
          try {
            state.configDraft[ta.dataset.cfgKey] = JSON.parse(ta.value);
            state.configDirty = true;
            document.getElementById('configDraftBanner').classList.remove('hidden');
          } catch (_) { /* пока JSON невалиден — не трогаем черновик */ }
        });
      });
      document.getElementById('previewConfigBtn').onclick = () => {
        showToast('Черновик применён локально. Для всех — кнопка «Закрепить».');
      };
      document.getElementById('saveConfigBtn').onclick = saveConfig;
    }

    async function saveConfig() {
      const pin = (document.getElementById('configPinInput') || {}).value || '';
      if (pin.replace(/\D/g, '').length < 4) { showToast('Введите ПИН конструктора.'); return; }
      const btn = document.getElementById('saveConfigBtn');
      btn.disabled = true;
      btn.textContent = 'Сохраняю…';
      try {
        const r = await stoneApi('save-app-config', { draft_config: state.configDraft, confirm_pin: pin });
        state.config = r.config || state.configDraft;
        state.configVersion = r.version || state.configVersion + 1;
        state.configDirty = false;
        renderConfigModal();
        showToast(`Конфиг закреплён: версия ${state.configVersion}.`);
        render();
      } catch (err) {
        showToast('Не сохранено: ' + (err && err.message ? err.message : err));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Закрепить и синхронизировать';
      }
    }

    // -----------------------------------------------------------------------
    // Этап 6: аттестация, чтение с таймером, тест
    // -----------------------------------------------------------------------
    async function loadAttestation() {
      try {
        state.attestation = await stoneApi('get-attestation', {});
        render();
      } catch (err) {
        console.warn('attestation failed:', err);
      }
    }

    async function loadAttReport() {
      try {
        const r = await stoneApi('attestation-report', {});
        state.attReport = r.rows || [];
        render();
      } catch (err) {
        state.attReport = [];
        render();
        showToast('Сводка недоступна: ' + (err && err.message ? err.message : err));
      }
    }

    async function openStudy(slug) {
      const mod = attModuleBySlug(slug);
      if (!mod) { showToast('Модуль не найден.'); return; }
      state.studyModule = slug;
      try {
        const r = await stoneApi('study-start', { slug });
        state.studySession = { id: r.session_id, seconds: Number(r.active_seconds || 0) };
      } catch (err) {
        showToast('Не удалось начать сессию: ' + (err && err.message ? err.message : err));
        state.studySession = null;
      }
      document.getElementById('studyModalTitle').textContent = mod.title;
      document.getElementById('studyModalBody').innerHTML = `<div class="md-body space-y-1">${mdToHtml(mod.study_content_md)}</div>`;
      updateStudyTimer();
      startHeartbeat();
      document.getElementById('studyModal').classList.remove('hidden');
      document.getElementById('studyToTestBtn').onclick = () => {
        closeStudy();
        startTest(slug);
      };
    }

    function updateStudyTimer() {
      const el = document.getElementById('studyTimer');
      if (!el) return;
      const sec = state.studySession ? state.studySession.seconds : 0;
      el.textContent = `Изучено: ${fmtMinutes(sec)}`;
    }

    function startHeartbeat() {
      stopHeartbeat();
      state.studyTimerId = setInterval(async () => {
        if (!state.studySession) return;
        if (document.visibilityState !== 'visible') return; // свёрнутая вкладка не засчитывается
        try {
          const r = await stoneApi('study-heartbeat', { session_id: state.studySession.id });
          state.studySession.seconds = Number(r.active_seconds || state.studySession.seconds);
          updateStudyTimer();
        } catch (_) { /* сеть пропала — следующий пинг догонит */ }
      }, 15000);
    }

    function stopHeartbeat() {
      if (state.studyTimerId) { clearInterval(state.studyTimerId); state.studyTimerId = null; }
    }

    async function closeStudy() {
      stopHeartbeat();
      const session = state.studySession;
      state.studySession = null;
      document.getElementById('studyModal').classList.add('hidden');
      if (!session) return;
      try {
        const r = await stoneApi('study-finish', { session_id: session.id });
        showToast(`Время изучения засчитано: ${fmtMinutes(r.active_seconds || session.seconds)}.`);
        await loadAttestation();
      } catch (_) {}
    }

    // -----------------------------------------------------------------------
    // Озвучка вопросов теста (Web Speech API, ru-RU)
    // -----------------------------------------------------------------------
    const VOICE_PREF_KEY = 'stone_test_voice';
    let ruVoice = null;
    let speechOn = false;

    function ttsSupported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

    function pickRuVoice() {
      if (!ttsSupported()) return null;
      const vs = window.speechSynthesis.getVoices() || [];
      ruVoice = vs.find(v => /^ru[-_]RU/i.test(v.lang)) || vs.find(v => /^ru/i.test(v.lang)) || null;
      return ruVoice;
    }
    if (ttsSupported()) {
      pickRuVoice();
      window.speechSynthesis.onvoiceschanged = () => pickRuVoice();
    }

    function stopSpeak() {
      speechOn = false;
      if (ttsSupported()) window.speechSynthesis.cancel();
    }

    function speakText(text, onDone) {
      if (!ttsSupported()) { showToast('Озвучка не поддерживается этим браузером.'); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text || ''));
      u.lang = 'ru-RU';
      u.rate = 0.98;
      u.pitch = 1;
      const v = ruVoice || pickRuVoice();
      if (v) u.voice = v;
      u.onend = () => { if (onDone) onDone(); };
      u.onerror = () => { if (onDone) onDone(); };
      window.speechSynthesis.speak(u);
    }

    // Один вопрос + его варианты
    function speakQuestion(i) {
      const a = state.attempt;
      const q = a && a.questions[i];
      if (!q) return;
      const opts = (q.options || []).map((o, k) => `Вариант ${k + 1}. ${o}`).join('. ');
      speechOn = false;
      speakText(`Вопрос ${i + 1}. ${q.text}. ${opts}`);
      showToast(`Озвучиваю вопрос ${i + 1}…`);
    }

    // Весь тест подряд
    function speakAllQuestions() {
      const a = state.attempt;
      if (!a) return;
      if (!ttsSupported()) { showToast('Озвучка не поддерживается этим браузером.'); return; }
      window.speechSynthesis.cancel();
      speechOn = true;
      const items = a.questions.map((q, i) => `Вопрос ${i + 1}. ${q.text}`);
      let i = 0;
      const next = () => {
        if (!speechOn || i >= items.length) {
          speechOn = false;
          showToast('Озвучка завершена.');
          return;
        }
        const cur = i++;
        speakText(items[cur], () => { if (speechOn) next(); });
      };
      next();
      showToast(`Озвучиваю ${items.length} вопросов. Кнопка «Стоп» остановит.`);
    }

    async function startTest(slug) {
      const mod = attModuleBySlug(slug);
      if (!mod) { showToast('Модуль не найден.'); return; }
      stopSpeak();
      try {
        const r = await stoneApi('attestation-start', { slug });
        state.attempt = {
          id: r.attempt_id,
          slug,
          title: mod.title,
          threshold: r.pass_threshold,
          attemptNo: r.attempt_no || 1,
          reworded: Boolean(r.reworded),
          questions: r.questions || [],
          answers: {},
          result: null
        };
        renderTestModal();
        document.getElementById('testModal').classList.remove('hidden');
        if (r.reworded) showToast('Пересдача: формулировки вопросов изменены, порядок ответов перемешан.');
        if (state.testVoice) setTimeout(() => speakQuestion(0), 350);
      } catch (err) {
        showToast('Тест не начат: ' + (err && err.message ? err.message : err));
      }
    }

    function renderTestModal() {
      const a = state.attempt;
      if (!a) return;
      document.getElementById('testModalTitle').textContent = a.title;
      document.getElementById('testProgress').textContent = a.result
        ? `Результат: ${a.result.score_percent}% · ${a.result.passed ? 'сдано' : 'не сдано'}`
        : `Вопросов: ${a.questions.length} · порог ${a.threshold}%`;
      const body = document.getElementById('testModalBody');
      const footer = document.getElementById('testModalFooter');

      if (a.result) {
        const byId = {};
        (a.result.details || []).forEach(d => { byId[d.id] = d; });
        body.innerHTML = `
          <div class="p-3 rounded-xl ${a.result.passed ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-rose-500/10 border border-rose-500/30'} space-y-1">
            <div class="text-sm font-semibold ${a.result.passed ? 'text-emerald-300' : 'text-rose-300'}">
              ${a.result.passed ? 'Модуль сдан ✓' : 'Порог не пройден'}
            </div>
            <div class="text-[11px] text-slate-300">Правильных: ${a.result.correct_count}/${a.result.total_count} · ${a.result.score_percent}% · время ${fmtMinutes(a.result.duration_seconds)}</div>
            ${a.result.passed ? '' : '<div class="text-[10px] text-slate-400 leading-relaxed">При пересдаче вопросы будут сформулированы немного иначе, а варианты ответов перемешаны — ответы заучивать бессмысленно.</div>'}
          </div>
          <div class="space-y-2">
            ${a.questions.map((q, i) => {
              const d = byId[q.id] || {};
              const mine = a.answers[q.id];
              return `
                <div class="p-2.5 rounded-xl bg-slate-950 border ${d.ok ? 'border-emerald-600/40' : 'border-rose-600/40'} space-y-1">
                  <div class="text-[11px] text-slate-200 font-medium">${i + 1}. ${escHtml(q.text)}</div>
                  <div class="text-[10px] ${d.ok ? 'text-emerald-300' : 'text-rose-300'}">Ваш ответ: ${mine != null ? escHtml(q.options[mine]) : '—'}</div>
                  ${d.ok ? '' : `<div class="text-[10px] text-emerald-300">Верно: ${escHtml(q.options[d.correct_index])}</div>`}
                  ${d.explanation ? `<div class="text-[10px] text-slate-400">${escHtml(d.explanation)}</div>` : ''}
                </div>`;
            }).join('')}
          </div>
        `;
        footer.innerHTML = `
          <button type="button" id="closeTestResultBtn" class="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-200">Закрыть</button>
          <button type="button" id="retryTestBtn" class="px-3.5 py-2 rounded-xl bg-blue-600 text-xs font-semibold text-white">Пройти заново</button>
        `;
        document.getElementById('closeTestResultBtn').onclick = () => {
          stopSpeak();
          state.attempt = null;
          document.getElementById('testModal').classList.add('hidden');
        };
        document.getElementById('retryTestBtn').onclick = () => { stopSpeak(); startTest(a.slug); };
        return;
      }

      body.innerHTML = `
        <div class="space-y-2.5">
          <div class="p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 flex-wrap">
            <label class="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer min-w-0">
              <input type="checkbox" id="testVoiceToggle" ${state.testVoice ? 'checked' : ''} class="w-3.5 h-3.5 accent-emerald-500 shrink-0" />
              <span class="truncate">Озвучивать вопросы</span>
            </label>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" id="speakAllBtn" class="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-[10px] text-emerald-200">▶ Озвучить</button>
              <button type="button" id="speakStopBtn" class="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] text-slate-300">■ Стоп</button>
            </div>
          </div>
          ${a.reworded ? `<p class="text-[10px] text-slate-500 leading-relaxed">Пересдача: формулировки вопросов изменены, порядок вариантов перемешан.</p>` : ''}
          ${a.questions.map((q, i) => `
            <div class="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <div class="flex items-start justify-between gap-1.5 min-w-0">
                <div class="text-[11px] text-slate-200 font-medium min-w-0">${i + 1}. ${escHtml(q.text)}</div>
                <button type="button" data-speak="${i}" class="speak-btn shrink-0 w-6 h-6 rounded-lg bg-slate-900 border border-slate-700 text-[10px] text-emerald-300" title="Прослушать вопрос с вариантами">🔊</button>
              </div>
              <div class="space-y-1">
                ${(q.options || []).map((opt, oi) => `
                  <label class="flex items-start gap-2 p-1.5 rounded-lg hover:bg-slate-900 cursor-pointer">
                    <input type="radio" name="q_${q.id}" value="${oi}" ${a.answers[q.id] === oi ? 'checked' : ''} class="mt-0.5 w-3.5 h-3.5 accent-blue-600" />
                    <span class="text-[10.5px] text-slate-300 leading-snug">${String(opt).replace(/</g, '&lt;')}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      body.querySelectorAll('input[type="radio"]').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const qid = Number(e.target.name.replace('q_', ''));
          state.attempt.answers[qid] = Number(e.target.value);
        });
      });
      body.querySelectorAll('[data-speak]').forEach(btn => {
        btn.onclick = () => speakQuestion(Number(btn.dataset.speak));
      });
      const vt = document.getElementById('testVoiceToggle');
      if (vt) {
        vt.onchange = () => {
          state.testVoice = vt.checked;
          try { localStorage.setItem(VOICE_PREF_KEY, vt.checked ? '1' : '0'); } catch (_) {}
          if (!vt.checked) stopSpeak();
          showToast(vt.checked ? 'Озвучка вопросов включена.' : 'Озвучка вопросов выключена.');
        };
      }
      const sa = document.getElementById('speakAllBtn');
      if (sa) sa.onclick = () => speakAllQuestions();
      const ss = document.getElementById('speakStopBtn');
      if (ss) ss.onclick = () => { stopSpeak(); showToast('Озвучка остановлена.'); };
      footer.innerHTML = `
        <span class="text-[10px] th-muted">Ответы проверяет сервер</span>
        <button type="button" id="submitTestBtn" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white">Завершить тест</button>
      `;
      document.getElementById('submitTestBtn').onclick = submitTest;
    }

    async function submitTest() {
      const a = state.attempt;
      if (!a) return;
      if (Object.keys(a.answers).length < a.questions.length) {
        if (!window.confirm(`Отвечено ${Object.keys(a.answers).length} из ${a.questions.length}. Завершить тест?`)) return;
      }
      const btn = document.getElementById('submitTestBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Проверяю…'; }
      try {
        const r = await stoneApi('attestation-submit', { attempt_id: a.id, answers: a.answers });
        a.result = r;
        renderTestModal();
        if (r.passed) showToast(`Модуль сдан: ${r.score_percent}%.`);
        await loadAttestation();
      } catch (err) {
        showToast('Не удалось завершить: ' + (err && err.message ? err.message : err));
        if (btn) { btn.disabled = false; btn.textContent = 'Завершить тест'; }
      }
    }

    // -----------------------------------------------------------------------
    // Этап 5: ИИ-ассистент
    // -----------------------------------------------------------------------
    // Понятный текст ошибки ИИ: Gemini работает только при включённом VPN
    function aiErrorText(err) {
      const msg = String(err && err.message ? err.message : err);
      const code = err && err.code;
      if (code === 'AI_NOT_CONFIGURED') {
        return 'ИИ-ассистент не настроен: в Supabase → Edge Functions → Secrets нет ключа ИИ. Остальные разделы приложения работают.';
      }
      if (code === 'AI_QUOTA') {
        return 'На сегодня бесплатные запросы к модели закончились — это лимит провайдера, а не сбой приложения.\n\nВопросы по карте знаний («Как убрать пост?», «Сколько длится вахта?» и подобные) продолжают отвечать мгновенно. Остаток квоты и время сброса видны в /health → checks.ai.fast_quota.';
      }
      if (code === 'AI_TIMEOUT') {
        return 'Модель не ответила за 20 секунд — перегружена. Повторите вопрос через минуту.';
      }
      if (code === 'AI_RATE_LIMIT') {
        return 'Лимит 30 вопросов в час исчерпан. Следующее окно откроется позже.';
      }
      if (code === 'AI_UPSTREAM' || /ИИ-ассистент недоступен|Gemini недоступен|AI_UPSTREAM/i.test(msg)) {
        return 'Ассистент не смог связаться с моделью. Если используется Gemini — включите VPN и повторите вопрос.\n\nОстальное приложение (график, бронь, аттестация) работает и без VPN.';
      }
      return 'Ошибка: ' + msg;
    }

    async function askAi(text) {
      const q = String(text || '').trim();
      if (q.length < 2) { showToast('Введите вопрос.'); return; }
      if (state.aiBusy) return;
      state.aiChat.push({ role: 'user', text: q });
      state.aiBusy = true;
      render();
      const log = document.getElementById('aiChatLog');
      if (log) log.scrollTop = log.scrollHeight;
      try {
        const history = state.aiChat.slice(0, -1).slice(-8);
        const r = await stoneApi('ai-assistant', { message: q, history });
        state.aiChat.push({
          role: 'model',
          text: r.answer || 'Пустой ответ.',
          ms: r.ms,
          provider: r.provider,
          note: r.matched_question || ''
        });
      } catch (err) {
        state.aiChat.push({ role: 'model', text: aiErrorText(err) });
      } finally {
        state.aiBusy = false;
        render();
        const log2 = document.getElementById('aiChatLog');
        if (log2) log2.scrollTop = log2.scrollHeight;
      }
    }

    // --- Экран входа и беспарольная веб-сессия ------------------------------
    let gatePollTimer = null;
    let gateCode = '';

    function showAuthGate() {
      const g = document.getElementById('authGate');
      if (g) g.classList.remove('hidden');
      // Фиксированный оверлей не мешает прокрутке страницы: без этого
      // витрину можно было открыть скроллом мимо экрана входа.
      document.body.style.overflow = 'hidden';
    }
    // Возврат экрана входа к первому шагу: без старого кода и статуса
    function resetGate() {
      stopGatePoll();
      gateCode = '';
      const s1 = document.getElementById('gateStep1');
      const s2 = document.getElementById('gateStep2');
      const rb = document.getElementById('gateRetryBtn');
      const st = document.getElementById('gateStatus');
      if (s1) s1.classList.remove('hidden');
      if (s2) s2.classList.add('hidden');
      if (rb) rb.classList.add('hidden');
      if (st) st.textContent = '';
      showPinForm(false);
    }

    // --- Запасной вход: телефон + 6-значный код от командира ----------------
    function showPinForm(show) {
      const pinBox = document.getElementById('gatePin');
      const s1 = document.getElementById('gateStep1');
      if (!pinBox || !s1) return;
      pinBox.classList.toggle('hidden', !show);
      s1.classList.toggle('hidden', show);
      const st = document.getElementById('gatePinStatus');
      if (st) {
        st.textContent = '';
        st.className = 'text-[11px] text-center min-h-[16px]';
      }
    }

    async function submitPinLogin() {
      const phoneEl = document.getElementById('gatePhoneInput');
      const pinEl = document.getElementById('gatePinInput');
      const btn = document.getElementById('gatePinSubmitBtn');
      const st = document.getElementById('gatePinStatus');
      if (!phoneEl || !pinEl || !btn || !st) return;

      const phone = (phoneEl.value || '').replace(/\D/g, '');
      const pin = (pinEl.value || '').replace(/\D/g, '');
      const say = (msg, tone) => {
        st.textContent = msg;
        st.className = 'text-[11px] text-center min-h-[16px] ' +
          (tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-300' : 'text-rose-400');
      };

      if (phone.length < 10) { say('Введите номер телефона'); phoneEl.focus(); return; }
      if (pin.length !== 6) { say('Код — ровно 6 цифр'); pinEl.focus(); return; }

      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Проверяю…';
      say('');
      try {
        const res = await fetch(STONE_API_URL + '/login-pin', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, STONE_API_HEADERS),
          body: JSON.stringify({ phone: phone, pin: pin })
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}

        if (res.status === 200 && data.token) {
          sessionToken = data.token;
          try { localStorage.setItem(SESSION_KEY, data.token); } catch (_) {}
          say('Вход выполнен. Загружаю данные…', 'ok');
          const ok = await loadCloudData(true);
          if (ok) {
            pinEl.value = '';
            phoneEl.value = '';
            showToast(`Вход выполнен: ${(data.employee && data.employee.full_name) || 'сотрудник'}`);
          }
          return;
        }
        if (res.status === 429) say(data.error || 'Слишком много попыток, повторите через 15 мин', 'warn');
        else say(data.error || 'Неверный номер или код');
      } catch (err) {
        say('Сервер недоступен. Проверьте связь и повторите.');
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    }

    function hideAuthGate() {
      const g = document.getElementById('authGate');
      if (g) g.classList.add('hidden');
      document.body.style.overflow = '';
      stopGatePoll();
    }
    function stopGatePoll() {
      if (gatePollTimer) { clearInterval(gatePollTimer); gatePollTimer = null; }
    }

    async function requestLoginCode() {
      const btn = document.getElementById('gateRequestBtn');
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Запрашиваю код…';
      try {
        const res = await fetch(STONE_API_URL + '/auth-request', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, STONE_API_HEADERS),
          body: '{}'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

        gateCode = data.code;
        document.getElementById('gateCode').textContent = data.code;
        document.getElementById('gateDeepLink').href = data.deep_link;
        document.getElementById('gateStep1').classList.add('hidden');
        document.getElementById('gateStep2').classList.remove('hidden');
        document.getElementById('gateRetryBtn').classList.add('hidden');
        document.getElementById('gateStatus').textContent = 'Ожидаю подтверждения в Telegram…';
        startGatePoll();
      } catch (err) {
        showToast('Не удалось получить код: ' + (err && err.message ? err.message : err));
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    }

    function startGatePoll() {
      stopGatePoll();
      gatePollTimer = setInterval(async () => {
        if (!gateCode) return;
        try {
          const res = await fetch(STONE_API_URL + '/auth-poll', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, STONE_API_HEADERS),
            body: JSON.stringify({ code: gateCode })
          });
          const data = await res.json();

          if (data.status === 'approved' && data.token) {
            sessionToken = data.token;
            try { localStorage.setItem(SESSION_KEY, data.token); } catch (_) {}
            document.getElementById('gateStatus').textContent = 'Вход подтверждён. Загружаю данные…';
            stopGatePoll();
            const ok = await loadCloudData(true);
            if (ok) showToast(`Вход выполнен: ${data.employee.full_name}`);
          } else if (data.status === 'code_received') {
            document.getElementById('gateStatus').textContent = 'Код принят. Подтвердите вход в боте.';
          } else if (data.status === 'rate_limited') {
            // Опрос останавливаем: каждый следующий запрос только продлевает окно
            // лимита, и человек не смог бы войти, пока не закроет страницу.
            stopGatePoll();
            document.getElementById('gateStatus').textContent =
              'Слишком частые запросы. Подождите минуту и нажмите «Получить новый код».';
            document.getElementById('gateRetryBtn').classList.remove('hidden');
          } else if (data.status === 'expired' || data.status === 'used' || res.status === 410) {
            stopGatePoll();
            document.getElementById('gateStatus').textContent = 'Код истёк. Получите новый.';
            document.getElementById('gateRetryBtn').classList.remove('hidden');
          }
        } catch (_) {}
        // 3 с вместо 2 с: срок жизни кода 10 минут, запас по лимитам больше,
        // а ожидание для человека не меняется.
      }, 3000);
    }

    document.getElementById('gateRequestBtn').addEventListener('click', requestLoginCode);
    document.getElementById('gateRetryBtn').addEventListener('click', requestLoginCode);
    document.getElementById('gateCancelBtn').addEventListener('click', resetGate);

    document.getElementById('gatePinToggleBtn').addEventListener('click', () => {
      showPinForm(true);
      const el = document.getElementById('gatePhoneInput');
      if (el) el.focus();
    });
    document.getElementById('gatePinBackBtn').addEventListener('click', () => showPinForm(false));
    document.getElementById('gatePinSubmitBtn').addEventListener('click', submitPinLogin);
    document.getElementById('gatePinInput').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });
    document.getElementById('gatePinInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitPinLogin();
    });

    // --- Модалки этапов 1–6: закрытие и ввод --------------------------------
    function bindModal(id, closeId) {
      const modal = document.getElementById(id);
      const btn = document.getElementById(closeId);
      if (btn) btn.addEventListener('click', () => modal.classList.add('hidden'));
      if (modal) modal.addEventListener('click', (e) => { if (e.target.id === id) modal.classList.add('hidden'); });
    }
    bindModal('postModal', 'closePostModalBtn');
    bindModal('deletePostModal', 'closeDeletePostModalBtn');
    // Модалка удаления лежит вне #mainContent, поэтому её кнопка подтверждения
    // требует собственного обработчика — общий delegation сюда не доходит.
    async function confirmDeletePost(btn) {
      const num = Number(btn?.dataset.num || 0);
      const pin = (document.getElementById('deletePostPin')?.value || '').trim();
      if (!pin) { showToast('Введите ПИН конструктора'); return; }
      btn.disabled = true;
      btn.textContent = 'Удаляю…';
      try {
        await stoneApi('delete-post', { post_number: num, pin });
        document.getElementById('deletePostModal').classList.add('hidden');
        showToast(`Пост №${num} полностью удалён.`);
        await loadCloudData(true);
      } catch (err) {
        showToast('Не удалось: ' + (err && err.message ? err.message : err));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Удалить пост навсегда';
      }
    }
    document.getElementById('deletePostModal').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="confirm-delete-post"]');
      if (btn) void confirmDeletePost(btn);
    });
    document.getElementById('deletePostPin').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('confirmDeletePostBtn').click();
      }
    });
    bindModal('empModal', 'closeEmpModalBtn');
    bindModal('configModal', 'closeConfigModalBtn');
    bindModal('testModal', 'closeTestModalBtn');
    // Закрытие теста останавливает озвучку
    ['closeTestModalBtn'].forEach((cid) => {
      const b = document.getElementById(cid);
      if (b) b.addEventListener('click', () => stopSpeak());
    });
    const testModalEl = document.getElementById('testModal');
    if (testModalEl) testModalEl.addEventListener('click', (e) => { if (e.target.id === 'testModal') stopSpeak(); });
    if (document.getElementById('closeStudyModalBtn')) {
      document.getElementById('closeStudyModalBtn').addEventListener('click', () => closeStudy());
    }
    if (document.getElementById('studyModal')) {
      document.getElementById('studyModal').addEventListener('click', (e) => {
        if (e.target.id === 'studyModal') closeStudy();
      });
    }

    document.getElementById('profileConfigBtn').addEventListener('click', () => {
      document.getElementById('profileModal').classList.add('hidden');
      openConfigModal();
    });

    // ИИ: выбор готового вопроса сразу отправляет его
    document.getElementById('mainContent').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-ai-faq]');
      if (!sel) return;
      const q = sel.value;
      sel.value = '';
      if (q) void askAi(q);
    });
    document.getElementById('mainContent').addEventListener('keydown', (e) => {
      if (e.target.id === 'aiInput' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = e.target.value.trim();
        e.target.value = '';
        void askAi(text);
      }
    });

    applyTheme();
    // Очередь оффлайн-отметок переживает перезагрузку: поднимаем её до первого рендера.
    state.offlineQueue = loadOfflineQueue();
    render();

    // Запуск: Telegram Mini App -> initData, иначе сохранённая веб-сессия, иначе экран входа
    (async function boot() {
      if (telegramInitData()) {
        await stoneAuthTelegram();
        await loadCloudData(true);
      } else if (sessionToken) {
        const ok = await loadCloudData(true);
        if (!ok) { resetGate(); showAuthGate(); }
      } else {
        resetGate();
        showAuthGate();
      }
      // Если в очереди остались отметки — отправляем их при каждом запуске.
      if (state.offlineQueue.length) void syncOfflineQueue(true);
    })();

    // Связь вернулась — досылаем то, что не ушло.
    window.addEventListener('online', () => {
      if (state.offlineQueue.length) void syncOfflineQueue(true);
    });
