function boolLabel(val) {
  if (val === 1) return 'Yes';
  if (val === 0) return 'No';
  return 'N/A';
}

function formatSiteDetails(site) {
  let creds = 'None';
  if (site.credentials) {
    try {
      const parsed = JSON.parse(site.credentials);
      creds = Object.entries(parsed)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
    } catch {
      creds = site.credentials;
    }
  }

  return [
    `*ID:* ${site.id}`,
    `*URL:* ${site.url}`,
    `*Domain:* ${site.domain}`,
    `*Category:* ${site.category}`,
    `*Working:* ${boolLabel(site.is_working)}`,
    `*Login works:* ${boolLabel(site.login_works)}`,
    `*Signup works:* ${boolLabel(site.signup_works)}`,
    `*Create content:* ${boolLabel(site.create_content_works)}`,
    `*Requires approval:* ${boolLabel(site.requires_approval)}`,
    `*Published:* ${boolLabel(site.is_published)}`,
    `*Credentials:*\n${creds}`,
    `*Notes:* ${site.notes || 'None'}`,
    `*Created:* ${site.created_at}`,
    `*Updated:* ${site.updated_at}`,
  ].join('\n');
}

function formatSiteRow(site) {
  const status = site.is_working ? 'Working' : 'Down';
  return `*${site.id}.* ${site.domain} [${site.category}] - ${status}`;
}

module.exports = { formatSiteDetails, formatSiteRow, boolLabel };
