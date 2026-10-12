import React, { useCallback, useEffect, useState } from "react";
import { getPublicBanner, getPublicGames, peekPublicBanner, peekPublicGames, PublicBanner, PublicGame } from "../../lib/paymentsApi";
import { useDropTick } from "../../lib/cache";
import { errorMessage } from "../../lib/http";
import { Banner, Spinner } from "../ui/ui";

// Shown as soon as the page loads; closes on ×, a backdrop click or Esc
const BannerPopup: React.FC<{ banner: PublicBanner; onClose: () => void }> = ({ banner, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const image = <img src={banner.imageUrl} alt="Announcement" className="block w-full h-auto max-h-[80vh] object-contain rounded-xl" />;
  return (
    <div className="anim-fade fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Announcement" className="relative w-full max-w-2xl anim-pop" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-gray-900 border border-gray-600 text-white text-xl leading-none hover:bg-red-600 hover:border-red-500"
        >
          ×
        </button>
        {banner.link ? (
          <a href={banner.link} target="_blank" rel="noopener noreferrer">
            {image}
          </a>
        ) : (
          image
        )}
      </div>
    </div>
  );
};

const GameTile: React.FC<{ game: PublicGame }> = ({ game }) => (
  <div className="group bg-white/5 rounded-xl border border-gray-700/50 overflow-hidden hover:border-red-500/50 transition-colors">
    {game.imageUrl ? (
      <img
        src={game.imageUrl}
        alt={game.name}
        width={600}
        height={600}
        loading="lazy"
        className="w-full aspect-square object-cover group-hover:scale-[1.03] transition-transform duration-300"
      />
    ) : (
      <div className="w-full aspect-square flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
        <span className="text-5xl font-bold text-red-500/70">{game.name.charAt(0).toUpperCase()}</span>
      </div>
    )}
    <div className="px-3 py-3 text-center">
      <h3 className="text-white font-semibold truncate">{game.name}</h3>
    </div>
  </div>
);

const PublicGames: React.FC = () => {
  const [games, setGames] = useState<PublicGame[] | null>(() => peekPublicGames() ?? null);
  const [banner, setBanner] = useState<PublicBanner | null>(() => peekPublicBanner() ?? null);
  const [error, setError] = useState("");

  // Shown from the cache at once; reloaded when a background check finds newer games
  const gamesChanged = useDropTick("/public/games");
  useEffect(() => {
    getPublicGames()
      .then(setGames)
      .catch((e) => setError(errorMessage(e, "Could not load the games")));
  }, [gamesChanged]);

  useEffect(() => {
    // The page works without the banner, so a failure here is ignored
    getPublicBanner()
      .then(setBanner)
      .catch(() => {});
  }, []);

  const closeBanner = useCallback(() => setBanner(null), []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      <header className="bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-5">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-white">
            Our <span className="text-red-500">Games</span>
          </h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {error && <Banner>{error}</Banner>}
        {!games && !error && (
          <div className="flex justify-center py-20 text-gray-400">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {games && games.length === 0 && <p className="text-center text-gray-400 py-20">No games available right now.</p>}
        {games && games.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {games.map((g) => (
              <GameTile key={g.id} game={g} />
            ))}
          </div>
        )}
      </main>

      {banner && <BannerPopup banner={banner} onClose={closeBanner} />}
    </div>
  );
};

export default PublicGames;
