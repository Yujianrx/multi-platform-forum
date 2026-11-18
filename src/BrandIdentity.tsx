import { brandAssets } from './brand-assets';
export function BrandIdentity({ site, publicView = false }: { site: any; publicView?: boolean }) {
  return (
    <>
      {site.hasLogo && !publicView ? (
        <img className="brand-image" src={'/api/logo?v=' + site.logoVersion} alt="" />
      ) : site.logo ? (
        <span className="brand-mark">{site.logo}</span>
      ) : (
        <img className="brand-wordmark" src={brandAssets.logo} alt="多端论坛" />
      )}
      <span className="brand-title">{site.name || '多端论坛'}</span>
    </>
  );
}
