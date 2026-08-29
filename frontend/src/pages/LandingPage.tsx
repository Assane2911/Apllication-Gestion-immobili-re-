import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-brand-500 selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/app-icon.png" alt="Logo" className="w-8 h-8 rounded-xl shadow" />
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              ImmoPlatform Pro
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-xs font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">
              Fonctionnalités
            </a>
            <a href="#pdf" className="hover:text-white transition-colors">
              Quittances & Signature
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Tarifs
            </a>
            <a href="#multi-currency" className="hover:text-white transition-colors">
              Multi-Devises
            </a>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <Link
                to={user.role === "MANAGER" ? "/" : "/portail"}
                className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-600/30"
              >
                Accéder à mon espace →
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-xs font-medium text-slate-300 hover:text-white px-3 py-2"
                >
                  Se connecter
                </Link>
                <Link
                  to="/login"
                  className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-lg shadow-brand-600/30"
                >
                  Essai 15j gratuit →
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 px-6 max-w-7xl mx-auto text-center overflow-hidden">
        <div className="inline-flex items-center gap-2 bg-brand-950/80 border border-brand-500/30 rounded-full px-4 py-1.5 text-xs text-brand-300 font-medium mb-8 shadow-inner">
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse"></span>
          Nouvelle Version 2.0 • 15 jours d'essai gratuit offert sans engagement
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
          La gestion locative <br />
          <span className="bg-gradient-to-r from-brand-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent italic">
            réinventée & automatisée.
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Générez vos quittances en PDF certifié, faites signer vos baux en ligne, envoyez vos relances
          automatiques du 1er du mois et suivez votre rentabilité nette en temps réel.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/login"
            className="w-full sm:w-auto bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm px-8 py-3.5 rounded-xl shadow-xl shadow-brand-600/30 transition-all hover:scale-105"
          >
            Démarrer l'essai 15 jours gratuit →
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-sm px-6 py-3.5 rounded-xl transition-all"
          >
            Tester en mode démo
          </Link>
        </div>

        {/* Feature Cards Grid */}
        <div id="features" className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-brand-600/20 text-brand-400 flex items-center justify-center text-2xl mb-4">
              📄
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Quittances & Baux PDF Certifiés</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Téléchargement instantané des quittances de loyer avec cachet de l'agence, numéro de série et
              mentions légales dès confirmation du paiement.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-2xl mb-4">
              ✍️
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Signature Tactile Électronique</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Faites signer vos contrats de location directement sur smartphone ou tablette. Horodatage et
              archivage numérique sécurisé.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center text-2xl mb-4">
              📢
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Alertes Automatiques du 1er du Mois</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Rappels programmés au 1er de chaque mois rappelant l'échéance de paiement au plus tard le 5
              avec lien de règlement sécurisé.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6 max-w-7xl mx-auto border-t border-slate-800/80">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-extrabold text-white">Des formules simples et transparentes</h2>
          <p className="text-sm text-slate-400 mt-3">
            Toutes les formules incluent 15 jours d'essai gratuit sans carte bancaire requise.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Starter */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Starter</span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">19€</span>
                <span className="text-slate-400 text-xs">/ mois</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Idéal pour les bailleurs indépendants.</p>
              <ul className="mt-6 space-y-3 text-xs text-slate-300">
                <li>✓ Jusqu'à 5 biens gérés</li>
                <li>✓ Quittances PDF certifiées</li>
                <li>✓ Rappels automatiques du 1er du mois</li>
                <li>✓ Portail locataire inclus</li>
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-8 w-full block text-center bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors"
            >
              Démarrer l'essai 15j
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-gradient-to-b from-brand-950/80 to-slate-900 border-2 border-brand-500 rounded-3xl p-8 flex flex-col justify-between relative shadow-2xl shadow-brand-900/40">
            <span className="absolute -top-3 right-6 bg-brand-500 text-white text-[10px] uppercase font-extrabold px-3 py-0.5 rounded-full tracking-wider">
              Recommandé
            </span>
            <div>
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Pro Agence</span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">49€</span>
                <span className="text-slate-400 text-xs">/ mois</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Pour agences et gestionnaires en croissance.</p>
              <ul className="mt-6 space-y-3 text-xs text-slate-200">
                <li>✓ Jusqu'à 25 biens gérés</li>
                <li>✓ ✍️ Signature électronique tactile</li>
                <li>✓ 💰 Suivi des dépenses & rentabilité</li>
                <li>✓ 🏢 Marque blanche (Logo & En-tête agence)</li>
                <li>✓ 💬 Messagerie directe intégrée</li>
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-8 w-full block text-center bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs py-3 rounded-xl transition-colors shadow-lg shadow-brand-600/30"
            >
              Démarrer l'essai 15j gratuit
            </Link>
          </div>

          {/* Enterprise */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Entreprise</span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-white">99€</span>
                <span className="text-slate-400 text-xs">/ mois</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Pour cabinets de gestion et grands parcs.</p>
              <ul className="mt-6 space-y-3 text-xs text-slate-300">
                <li>✓ Biens illimités</li>
                <li>✓ Support dédié prioritaire 24/7</li>
                <li>✓ Multi-utilisateurs & gestionnaires</li>
                <li>✓ Export comptable automatisé</li>
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-8 w-full block text-center bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-3 rounded-xl transition-colors"
            >
              Démarrer l'essai 15j
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-12 px-6 bg-slate-950 text-center text-xs text-slate-500">
        <p>© 2026 ImmoPlatform Pro. Tous droits réservés.</p>
        <p className="mt-2">Logiciel de gestion locative immobilière certifié et sécurisé.</p>
      </footer>
    </div>
  );
}
