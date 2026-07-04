        const SUPABASE_URL = 'https://dbxhaseoxpnmzdxbzdpj.supabase.co';
        const SUPABASE_KEY = 'sb_publishable_UcpiMVqtkCgky9HN8nu85Q_iFXsVY_r';
        const supabaseClient = window.supabase?.createClient
            ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: {
                    // SECURITY: the main app must NEVER authenticate from a token in the
                    // URL (e.g. a Supabase password-recovery link). Password recovery is
                    // handled exclusively by the isolated reset-password.html page. This
                    // prevents a recovery link from silently logging someone into the app.
                    detectSessionInUrl: false,
                },
            })
            : null;

        // Column name for the date-only watch date field in both "Movie Ratings" and "Watch Logs".
        // If you rename the column to a different identifier (e.g. "Watch_Date"), update this value.
        const COL_WATCH_DATE = 'watch_date';

        // Web Push: the PUBLIC half of the VAPID keypair (safe to ship to clients).
        // The PRIVATE half is set as a Supabase edge-function secret (VAPID_PRIVATE),
        // never in the front end. See push_subscriptions.sql + the swift-api edge fn.
        const VAPID_PUBLIC_KEY = 'BKOTbNf7OJTkr1h3t0f3MkEbtVu_3EXqFxvCGZOIT3OY0D7MHftadccjI_6jVUMQssj5wXTxsbybcURskc9Re6g';

        const icons = {
            film: `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>`,
            menu: `<svg viewBox="0 0 24 24"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
            checkCircle: `<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
            twitter: `<svg viewBox="0 0 24 24"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-12.7 14-4.5-4.5 1.6-11.7 8-12 1.1-2 3.5-3.5 6-3.5 0 0 .7 3.4 2.7 4.5"/></svg>`,
            github: `<svg viewBox="0 0 24 24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>`,
            instagram: `<svg viewBox="0 0 24 24"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>`,
            search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
            filter: `<svg viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
            sort: `<svg viewBox="0 0 24 24"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>`,
            clearX: `<svg viewBox="0 0 24 24"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/></svg>`,
            plusCircle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`,
            refreshCw: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>`,
            arrowRight: `<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
            arrowRightCircle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="m12 16 4-4-4-4"/></svg>`,
            clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
            barChart2: `<svg viewBox="0 0 24 24"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>`,
            star: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
            arrowLeft: `<svg viewBox="0 0 24 24"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
            database: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
            info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
            edit3: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
            quote: `<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>`,
            save: `<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
            calendar: `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
            trendingUp: `<svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
            trendingDown: `<svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
            percent: `<svg viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
            activity: `<svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
            pieChart: `<svg viewBox="0 0 24 24"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>`,
            video: `<svg viewBox="0 0 24 24"><rect x="3" y="7" width="14" height="10" rx="2" ry="2"/><path d="m17 10 4-2v8l-4-2z"/></svg>`,
            tv: `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="12" rx="2" ry="2"/><path d="M7 21h10"/><path d="M12 7 8 3"/><path d="M12 7l4-4"/></svg>`,
            user: `<svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`,
            users: `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
            trash2: `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
            loader: `<svg viewBox="0 0 24 24" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
            gamepad: `<svg viewBox="0 0 24 24"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>`
        };
        const navLogoEl = document.getElementById('nav-logo-icon');
        if (navLogoEl) {
            navLogoEl.innerHTML = '';
        }

        async function fetchNavLogoUrl(themeId) {
            if (!supabaseClient) return null;
            const themeKey = String(themeId || '').trim();
            if (!themeKey) return null;
            const query = supabaseClient
                .from('Logos')
                .select('url')
                .order('created_at', { ascending: false })
                .limit(1);

            const { data, error } = await query.eq('theme_id', themeKey).maybeSingle();
            if (error || !data?.url) return null;
            return data.url;
        }

        async function loadNavLogoForTheme(themeId) {
            if (!navLogoEl) return;
            try {
                const themeKey = String(themeId || '').trim();
                let url = await fetchNavLogoUrl(themeKey);
                navLogoEl.innerHTML = url
                    ? `<img src="${url}" alt="CinemaTracker" loading="lazy" decoding="async" />`
                    : '';
            } catch (_) {
                navLogoEl.innerHTML = '';
            }
        }
        document.getElementById('menu-icon-btn').innerHTML = icons.menu;
        document.getElementById('toast-icon').innerHTML = icons.checkCircle;
        document.getElementById('footer-icons').innerHTML = `
            <a href="#">${icons.twitter}</a>
            <a href="#">${icons.github}</a>
            <a href="#">${icons.instagram}</a>
        `;
