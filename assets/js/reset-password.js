        const SUPABASE_URL = 'https://dbxhaseoxpnmzdxbzdpj.supabase.co';
        const SUPABASE_KEY = 'sb_publishable_UcpiMVqtkCgky9HN8nu85Q_iFXsVY_r';
        // SECURITY: use a fully isolated, in-memory-only session for the recovery flow.
        // persistSession:false means the temporary recovery session is NEVER written to
        // the storage shared with the main app, so a recovery link can never grant access
        // to the website. detectSessionInUrl stays on so the token in the link is parsed.
        const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: true,
            },
        });

        const pwdEl = document.getElementById('new-password');
        const confirmEl = document.getElementById('confirm-password');
        const submitBtn = document.getElementById('submit-btn');
        const statusEl = document.getElementById('status');

        // Track whether a valid recovery session was established from the email link.
        let hasRecoverySession = false;

        // Password rule checks. Returns an object of { ruleName: bool }.
        function evaluate() {
            const pwd = pwdEl.value;
            const confirm = confirmEl.value;
            return {
                length: pwd.length >= 8,
                upper: /[A-Z]/.test(pwd),
                lower: /[a-z]/.test(pwd),
                number: /[0-9]/.test(pwd),
                special: /[^A-Za-z0-9]/.test(pwd),
                match: pwd.length > 0 && pwd === confirm,
            };
        }

        function refreshUI() {
            const result = evaluate();
            let allValid = true;
            document.querySelectorAll('#rules li').forEach((li) => {
                const rule = li.getAttribute('data-rule');
                const ok = !!result[rule];
                li.classList.toggle('valid', ok);
                if (!ok) allValid = false;
            });
            submitBtn.disabled = !(allValid && hasRecoverySession);
            return allValid;
        }

        pwdEl.addEventListener('input', refreshUI);
        confirmEl.addEventListener('input', refreshUI);

        function setStatus(msg, kind) {
            statusEl.textContent = msg;
            statusEl.className = 'status' + (kind ? ' ' + kind : '');
        }

        // On arrival via the recovery link, supabase-js parses the token from the URL
        // hash and establishes a temporary session. Confirm it exists.
        async function init() {
            supabaseClient.auth.onAuthStateChange((event, session) => {
                if (session) { hasRecoverySession = true; refreshUI(); }
            });

            // Give supabase-js a moment to process the URL hash, then verify the session.
            const { data } = await supabaseClient.auth.getSession();
            if (data?.session) {
                hasRecoverySession = true;
            } else {
                hasRecoverySession = false;
                setStatus('This reset link is invalid or has expired. Please request a new one from the login screen.', 'error');
            }
            refreshUI();
        }

        async function submit() {
            if (!refreshUI()) return;
            if (!hasRecoverySession) {
                setStatus('This reset link is invalid or has expired. Please request a new one.', 'error');
                return;
            }
            if (pwdEl.value !== confirmEl.value) {
                setStatus('Passwords do not match.', 'error');
                return;
            }

            const prevText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Updating…';
            setStatus('Updating your password…', '');

            try {
                // Update the password using the temporary, in-memory recovery session.
                const { error } = await supabaseClient.auth.updateUser({ password: pwdEl.value });
                if (error) throw error;

                // SECURITY: never carry the recovery session into the app. Discard the
                // in-memory session so nothing can leak to the main site, then send the
                // user to log in fresh with their new password.
                try { await supabaseClient.auth.signOut(); } catch (_) {}

                setStatus('Password updated! Please log in with your new password…', 'success');
                setTimeout(() => { window.location.href = 'index.html'; }, 1100);
            } catch (err) {
                submitBtn.disabled = false;
                submitBtn.textContent = prevText;
                setStatus('Could not update password: ' + String(err?.message || err), 'error');
            }
        }

        submitBtn.addEventListener('click', submit);
        init();
