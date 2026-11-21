// Meldingen voor de beheerder via Home Assistant (pushmelding, e-mail of melding in HA).

/**
 * @param {string} service bv. "persistent_notification.create" of "notify.mobile_app_telefoon_frederic"
 * @param {object} log
 */
export function makeNotifier(service, log) {
  return async function notify(title, message) {
    log.info(`Melding: ${title} – ${message}`);
    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) return; // buiten Home Assistant (tests)
    const [domain, name] = (service || 'persistent_notification.create').split('.');
    try {
      const res = await fetch(`http://supervisor/core/api/services/${domain}/${name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message })
      });
      if (!res.ok) log.error(`Melding mislukt (${service}): HTTP ${res.status}`);
    } catch (err) {
      log.error(`Melding mislukt (${service}): ${err.message}`);
    }
  };
}
