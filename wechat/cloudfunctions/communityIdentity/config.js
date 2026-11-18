function communityOrigin() {
  const value = process.env.COMMUNITY_ORIGIN;
  if (!value) throw new Error('COMMUNITY_ORIGIN is required');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('COMMUNITY_ORIGIN must be an HTTPS origin');
  return url.origin;
}

module.exports = { communityOrigin };
