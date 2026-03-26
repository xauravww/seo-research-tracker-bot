function extractDomain(input) {
  let urlStr = input.trim();
  if (!/^https?:\/\//i.test(urlStr)) {
    urlStr = 'https://' + urlStr;
  }
  try {
    const parsed = new URL(urlStr);
    return {
      url: parsed.href,
      domain: parsed.hostname.replace(/^www\./, ''),
    };
  } catch {
    return null;
  }
}

function looksLikeUrl(text) {
  return /^(https?:\/\/)?[\w.-]+\.\w{2,}(\/\S*)?$/i.test(text.trim());
}

module.exports = { extractDomain, looksLikeUrl };
