        let cachedAuthUser = null;
        let cachedIsAuthed = false;

        // ─── Guest / Demo Mode ───
        let guestMode = false;
        let _pendingGuestPage = null; // page user tried to visit before auth
        const DEMO_USER_ID = '02e69be6-32eb-447e-9a0c-9469dc5ea41e';

        /** Returns the active user ID — demo user in guest mode, real user otherwise. */
        function getActiveUserId() {
            if (guestMode) return DEMO_USER_ID;
            return cachedAuthUser?.id || null;
        }

        /** Block a write operation in guest mode. Returns true if blocked. */
        function guardGuestWrite() {
            if (!guestMode) return false;
            showToast('Create an account to use this feature', { level: 'info' });
            return true; // blocked
        }

        /** Enter demo/guest mode — loads the demo user's data without auth. */
        function enterGuestMode() {
            guestMode = true;
            cachedIsAuthed = true; // pretend authed so pages render
            cachedAuthUser = { id: DEMO_USER_ID, email: 'demo@cinematracker.app' };

            // Persist across refresh
            try { sessionStorage.setItem('ct_guest_mode', '1'); } catch (_) {}

            // Show banner & adjust layout
            const banner = document.getElementById('demo-banner');
            if (banner) banner.classList.add('visible');
            document.body.classList.add('guest-mode');

            // Show/hide banner Sign Up based on siteSignupEnabled
            const bannerSignup = document.getElementById('demo-banner-signup');
            if (bannerSignup) bannerSignup.style.display = siteSignupEnabled ? '' : 'none';

            // Update nav button
            const navBtn = document.getElementById('nav-login-btn');
            if (navBtn) { navBtn.textContent = 'Demo'; navBtn.classList.remove('icon-only'); }
            const mobileBtn = document.getElementById('mobile-auth-btn');
            if (mobileBtn) mobileBtn.textContent = 'Demo';
            const moreBtn = document.getElementById('more-auth-btn');
            if (moreBtn) moreBtn.textContent = 'Demo';

            // Navigate to the page the user was trying to reach, or home
            const target = _pendingGuestPage || (window.location.hash || '').replace('#', '') || 'home';
            _pendingGuestPage = null;
            router.navigate(target);
        }

        /** Exit guest mode and return to unauthenticated state. */
        function exitGuestMode() {
            guestMode = false;
            cachedIsAuthed = false;
            cachedAuthUser = null;

            // Clear persistence
            try { sessionStorage.removeItem('ct_guest_mode'); } catch (_) {}

            // Hide banner & revert layout
            const banner = document.getElementById('demo-banner');
            if (banner) banner.classList.remove('visible');
            document.body.classList.remove('guest-mode');

            // Reset nav button
            const navBtn = document.getElementById('nav-login-btn');
            if (navBtn) { navBtn.textContent = 'Login'; navBtn.classList.remove('icon-only'); }
            const mobileBtn = document.getElementById('mobile-auth-btn');
            if (mobileBtn) mobileBtn.textContent = 'Login';
            const moreBtn = document.getElementById('more-auth-btn');
            if (moreBtn) moreBtn.textContent = 'Login';

            // Reset cached data
            cachedLists = [];
            cachedListsUserId = null;
            listsActiveListId = null;
            listsActiveListName = '';

            // Re-open mandatory auth gate
            openAuthModal();
        }

        let cachedUserDisplayNameId = null;
        let cachedUserDisplayName = '';
        let cachedUserDisplayNameLoaded = false;
        let cachedUserIconId = null;
        let cachedUserIcon = '';
        let cachedUserIconLoaded = false;

