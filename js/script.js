

(() => {
  const CONFIG = {
    forms: [
      { id: 'enquiryForm', kind: 'enquiry' },
      { id: 'contactForm', kind: 'contact' },
    ],

    rateLimit: {
      windowMs: 10 * 60 * 1000, // 10 minutes
      maxSubmissions: 3,
    },

    minDelayMs: 1200, // basic anti-bot timing
    maxChars: {
      fullname: 80,
      email: 120,
      phone: 25,
      subject: 60,
      careerInterest: 60,
      educationLevel: 60,
      message: 1200,
    },

    // Very lightweight allow-list checks (defense-in-depth)
    patterns: {
      // letters + spaces + common separators/apostrophes/hyphens
      fullname: /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[ '\-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/,
      // conservative email pattern
      email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
      // allow digits and common phone formatting characters
      phone: /^[0-9+()\-\s.]{6,25}$/,
    },

    message: {
      maxConsecutiveBad: 6,
      // Detect very suspicious payload patterns; this is not a replacement for server-side validation.
      suspiciousPatterns: [
        /<\s*script/gi,
        /on\w+\s*=/gi,
        /javascript\s*:/gi,
        /document\.(cookie|write|location)/gi,
        /<\s*iframe/gi,
      ],
      minLength: 20,
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function now() {
    return Date.now();
  }

  function normalize(str) {
    return String(str ?? '').trim().replace(/\s+/g, ' ');
  }

  function safeText(el, text) {
    el.textContent = String(text ?? '');
  }

  function getRateKey(formId) {
    // Key is per browser + form + day
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `fhh_rate_${formId}_${day}`;
  }

  function checkRateLimit(formId) {
    const key = getRateKey(formId);
    let entry;
    try {
      entry = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      entry = {};
    }

    const windowStart = now() - CONFIG.rateLimit.windowMs;
    const times = Array.isArray(entry.times) ? entry.times : [];
    const filtered = times.filter((t) => typeof t === 'number' && t >= windowStart);

    const allowed = filtered.length < CONFIG.rateLimit.maxSubmissions;
    return { allowed, remaining: Math.max(0, CONFIG.rateLimit.maxSubmissions - filtered.length), times: filtered };
  }

  function recordSubmission(formId) {
    const key = getRateKey(formId);
    let entry;
    try {
      entry = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      entry = {};
    }
    const windowStart = now() - CONFIG.rateLimit.windowMs;
    const times = Array.isArray(entry.times) ? entry.times : [];
    const filtered = times.filter((t) => typeof t === 'number' && t >= windowStart);
    filtered.push(now());

    localStorage.setItem(key, JSON.stringify({ times: filtered }));
  }

  function checkMinDelay(formId) {
    const key = `fhh_last_${formId}`;
    const last = Number(localStorage.getItem(key) || '0');
    const delta = now() - (Number.isFinite(last) ? last : 0);
    localStorage.setItem(key, String(now()));
    return delta >= CONFIG.minDelayMs;
  }

  function truncate(s, max) {
    const str = String(s ?? '');
    return str.length > max ? str.slice(0, max) : str;
  }

  function validateCommon({ fullname, email, phone, message }) {
    const errors = [];

    const name = normalize(fullname);
    if (!name) errors.push('Full name is required.');
    if (name.length > CONFIG.maxChars.fullname) errors.push('Full name is too long.');
    if (name && !CONFIG.patterns.fullname.test(name)) errors.push('Full name contains invalid characters.');

    const e = normalize(email);
    if (!e) errors.push('Email address is required.');
    if (e.length > CONFIG.maxChars.email) errors.push('Email is too long.');
    if (e && !CONFIG.patterns.email.test(e)) errors.push('Email address looks invalid.');

    const p = normalize(phone);
    if (p && p.length > CONFIG.maxChars.phone) errors.push('Phone number is too long.');
    if (p && !CONFIG.patterns.phone.test(p)) errors.push('Phone number contains invalid characters.');

    const m = String(message ?? '');
    const msg = normalize(m);
    if (!msg) errors.push('Message is required.');
    if (msg.length < CONFIG.message.minLength) errors.push('Message is too short. Please add more detail.');
    if (msg.length > CONFIG.maxChars.message) errors.push('Message is too long. Please shorten it.');

    for (const re of CONFIG.message.suspiciousPatterns) {
      if (re.test(msg)) {
        errors.push('Message contains potentially unsafe content. Please revise and try again.');
        break;
      }
    }

    // Prevent “obvious spam” patterns (very lightweight)
    const badRuns = (msg.match(/\b(?:test|asdf|spam|click|http)\b/gi) || []).length;
    if (badRuns > CONFIG.message.maxConsecutiveBad) {
      errors.push('Message appears to be spam. Please revise.');
    }

    return { errors, cleaned: { fullname: name, email: e, phone: p, message: msg } };
  }

  function buildStatusUI(formEl) {
    // Create/locate a dedicated status container.
    const existing = $('[data-fhh-status]', formEl);
    if (existing) return existing;

    const wrap = document.createElement('div');
    wrap.setAttribute('data-fhh-status', 'true');
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.style.marginTop = '12px';
    wrap.style.padding = '10px 12px';
    wrap.style.borderRadius = '10px';
    wrap.style.display = 'none';

    // Basic inline styling to avoid dependency on CSS changes.
    wrap.style.border = '1px solid rgba(0,0,0,0.08)';
    wrap.style.background = 'rgba(0,0,0,0.03)';

    formEl.appendChild(wrap);
    return wrap;
  }

  function showStatus(statusEl, { type, message }) {
    // type: success | error | info
    const t = type || 'info';
    statusEl.style.display = 'block';

    if (t === 'success') {
      statusEl.style.borderColor = 'rgba(16, 185, 129, 0.45)';
      statusEl.style.background = 'rgba(16, 185, 129, 0.10)';
    } else if (t === 'error') {
      statusEl.style.borderColor = 'rgba(239, 68, 68, 0.45)';
      statusEl.style.background = 'rgba(239, 68, 68, 0.10)';
    } else {
      statusEl.style.borderColor = 'rgba(0,0,0,0.08)';
      statusEl.style.background = 'rgba(0,0,0,0.03)';
    }

    safeText(statusEl, message);
  }

  function setSubmitting(formEl, isSubmitting) {
    const btn = $('button[type="submit"], button.submit-btn, input[type="submit"]', formEl);
    if (btn) {
      btn.disabled = !!isSubmitting;
      btn.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
      btn.dataset.fhhOriginalText = btn.dataset.fhhOriginalText || btn.textContent.trim();
      if (isSubmitting) btn.textContent = 'Submitting...';
      else btn.textContent = btn.dataset.fhhOriginalText || btn.textContent;
    }

    // Prevent double-submit via keyboard.
    formEl.setAttribute('data-fhh-submitting', isSubmitting ? '1' : '0');
  }

  function isSubmitting(formEl) {
    return formEl.getAttribute('data-fhh-submitting') === '1';
  }

  function getField(formEl, id) {
    const el = document.getElementById(id);
    if (!el) return '';
    // Guard: ensure the element belongs to this form.
    if (!formEl.contains(el)) return '';
    return el.value;
  }

  function getSelectValue(formEl, id) {
    const el = document.getElementById(id);
    if (!el || !formEl.contains(el)) return '';
    return el.value;
  }

  function validateSelectNonEmpty(value, label) {
    const v = normalize(value);
    if (!v) return `${label} is required.`;
    if (v.length > 60) return `${label} is too long.`;
    return null;
  }

  function preparePayload(formKind, cleaned, formEl) {
    // Prepare a “future backend” payload without sending anywhere.
    // Ensure no raw DOM content is injected.
    const base = {
      kind: formKind,
      submittedAt: new Date().toISOString(),
      // no IPs/tokens here (client only)
      fullname: cleaned.fullname,
      email: cleaned.email,
      phone: cleaned.phone || null,
      message: cleaned.message,
      userAgent: navigator.userAgent?.slice(0, 160) || null,
    };

    if (formKind === 'enquiry') {
      base.subject = normalize(getSelectValue(formEl, 'subject'));
      base.careerInterest = normalize(getSelectValue(formEl, 'career-interest'));
      base.educationLevel = normalize(getSelectValue(formEl, 'education-level'));
    }

    if (formKind === 'contact') {
      base.subject = normalize(getSelectValue(formEl, 'subject'));
    }

    return base;
  }

  function attachHandlers() {
    CONFIG.forms.forEach(({ id, kind }) => {
      const formEl = document.getElementById(id);
      if (!formEl) return;

      const statusEl = buildStatusUI(formEl);

      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (isSubmitting(formEl)) return;

        // Rate limiting
        const rate = checkRateLimit(id);
        const minDelayOk = checkMinDelay(id);
        if (!rate.allowed || !minDelayOk) {
          const waitMsg = !rate.allowed
            ? `Too many submissions. Please try again later. (${rate.remaining} attempts remaining in this window)`
            : 'Please wait a moment before submitting again.';
          showStatus(statusEl, { type: 'error', message: waitMsg });
          return;
        }

        // Disable submit while validating
        setSubmitting(formEl, true);

        try {
          const rawFullname = getField(formEl, 'fullname');
          const rawEmail = getField(formEl, 'email');
          const rawPhone = getField(formEl, 'phone');
          const rawMessage = getField(formEl, 'message');

          const { errors, cleaned } = validateCommon({
            fullname: rawFullname,
            email: rawEmail,
            phone: rawPhone,
            message: rawMessage,
          });

          // Select-specific validations
          if (kind === 'enquiry') {
            const subjectErr = validateSelectNonEmpty(getSelectValue(formEl, 'subject'), 'Subject');
            const careerErr = validateSelectNonEmpty(getSelectValue(formEl, 'career-interest'), 'Career of Interest');
            const eduErr = validateSelectNonEmpty(getSelectValue(formEl, 'education-level'), 'Current Education Level');
            if (subjectErr) errors.push(subjectErr);
            if (careerErr) errors.push(careerErr);
            if (eduErr) errors.push(eduErr);
          }

          if (kind === 'contact') {
            const subjectErr = validateSelectNonEmpty(getSelectValue(formEl, 'subject'), 'Subject');
            if (subjectErr) errors.push(subjectErr);
          }

          if (errors.length) {
            showStatus(statusEl, {
              type: 'error',
              message: errors[0],
            });
            return;
          }

          // Everything validated
          recordSubmission(id);

          const payload = preparePayload(kind, cleaned, formEl);

          // For professional behavior: no backend exists; so we show success and clear the form.
          // Keep payload only for dev visibility.
          // eslint-disable-next-line no-console
          console.log('[FutureHealthHub] prepared payload:', payload);

          showStatus(statusEl, {
            type: 'success',
            message: 'Your submission was received successfully. Our advisors will respond within 48 hours.',
          });

          formEl.reset();
        } finally {
          setSubmitting(formEl, false);
        }
      });
    });
  }

  // Defensive: don’t assume the script loads after the forms.
  // Run on DOM ready and also on load.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachHandlers, { once: true });
  } else {
    attachHandlers();
  }
})();

