# Browser-Based Background Location via Service Worker

We chose to implement officer GPS tracking through a Service Worker with Periodic Background Sync for Android Chrome, falling back to foreground-only Geolocation with "last seen" timestamps for iOS Safari.

The alternatives were: (a) a native mobile app wrapper for full background GPS, which would require app store distribution and maintenance overhead disproportionate to a 10–20 user base; (b) silent push notifications to wake the browser, which requires a push subscription server and VAPID key infrastructure that conflicts with the no-new-infrastructure constraint; (c) foreground-only tracking, which fails the operator requirement of maintaining position updates when the phone screen is off.

Service Worker Background Sync satisfies the requirement on Android (the dominant platform for field officers) while accepting the iOS limitation with clear UX feedback ("อัพเดทล่าสุดเมื่อ X นาทีก่อน"), avoiding new backend services or native app builds.
