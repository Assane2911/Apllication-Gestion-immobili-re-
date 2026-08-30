import LegalLayout, { LegalList, LegalSection } from "../../components/LegalLayout";
import { COMPANY, SUBPROCESSORS } from "../../legal/companyInfo";

export default function PolitiqueConfidentialitePage() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <LegalSection title="1. Responsable du traitement">
        <p>
          Le responsable du traitement des données personnelles collectées via {COMPANY.tradeName} est{" "}
          {COMPANY.fullName} ({COMPANY.legalStatus}), {COMPANY.address}, joignable à {COMPANY.contactEmail}.
        </p>
        <p>
          Pour les données de ses propres Locataires, le Gestionnaire (l'agence ou le bailleur utilisant le
          Service) agit lui-même en qualité de responsable de traitement ; {COMPANY.tradeName} intervient
          alors en qualité de sous-traitant au sens de l'article 28 du Règlement Général sur la Protection
          des Données (RGPD).
        </p>
      </LegalSection>

      <LegalSection title="2. Données collectées">
        <p>Selon votre rôle (Gestionnaire ou Locataire), le Service collecte :</p>
        <LegalList
          items={[
            <>
              <strong className="text-slate-100">Données de compte</strong> : email, mot de passe (stocké
              sous forme hachée, jamais en clair), rôle (gestionnaire ou locataire).
            </>,
            <>
              <strong className="text-slate-100">Données d'agence</strong> (Gestionnaire) : nom commercial,
              numéro d'immatriculation, adresse, coordonnées, mentions légales personnalisées.
            </>,
            <>
              <strong className="text-slate-100">Données de biens immobiliers</strong> : adresse, surface,
              loyer, photographies.
            </>,
            <>
              <strong className="text-slate-100">Données de locataire</strong> : nom, prénom, téléphone,
              email, pièce d'identité (image ou PDF).
            </>,
            <>
              <strong className="text-slate-100">Données contractuelles et financières</strong> : contrats de
              bail, montants de loyer et dépôts de garantie, historique des paiements, dépenses.
            </>,
            <>
              <strong className="text-slate-100">Photos d'incidents</strong> : photographies transmises par
              les Locataires lors du signalement d'un problème dans leur logement.
            </>,
            <>
              <strong className="text-slate-100">Messages</strong> échangés entre Gestionnaire et Locataire
              via la messagerie intégrée.
            </>,
            <>
              <strong className="text-slate-100">Données de préférence</strong> : langue d'affichage, thème
              clair/sombre, devise d'affichage — stockées localement dans votre navigateur.
            </>,
            <>
              <strong className="text-slate-100">Données techniques</strong> : journaux de connexion et
              d'activité nécessaires à la sécurité et à la traçabilité des actions (journal d'activité de
              l'agence).
            </>,
          ]}
        />
        <p>
          {COMPANY.tradeName} n'a jamais accès aux données bancaires (numéro de carte, etc.) : ces données
          transitent exclusivement par nos prestataires de paiement (voir section 5).
        </p>
      </LegalSection>

      <LegalSection title="3. Finalités et bases légales du traitement">
        <LegalList
          items={[
            "Exécution du contrat : fourniture du Service, gestion des comptes, des biens, contrats, paiements et incidents (base légale : exécution contractuelle).",
            "Émission des quittances de loyer et documents contractuels, à des fins de conformité comptable et fiscale (base légale : obligation légale et intérêt légitime).",
            "Envoi de rappels automatiques de paiement et de notifications relatives aux biens gérés (base légale : exécution contractuelle et intérêt légitime).",
            "Sécurité du Service et prévention de la fraude (base légale : intérêt légitime).",
            "Support utilisateur et réponse aux demandes (base légale : intérêt légitime / consentement).",
            "Amélioration du Service (statistiques d'usage agrégées) (base légale : intérêt légitime).",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Destinataires des données">
        <p>
          Les données sont accessibles au Gestionnaire concerné (pour les données de ses propres biens et
          locataires, dans le cadre de l'isolation stricte entre agences mise en œuvre par le Service) et,
          dans la limite du nécessaire, aux prestataires techniques suivants.
        </p>
      </LegalSection>

      <LegalSection title="5. Sous-traitants et hébergement">
        <LegalList
          items={[
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.database.name}</strong> —{" "}
              {SUBPROCESSORS.database.role} {SUBPROCESSORS.database.address}
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.hostingFrontendBackend.name}</strong> —{" "}
              {SUBPROCESSORS.hostingFrontendBackend.role} Société établie aux États-Unis ; les transferts de
              données hors Union Européenne sont, le cas échéant, encadrés par les clauses contractuelles
              types de la Commission européenne.
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.paymentStripe.name}</strong> —{" "}
              {SUBPROCESSORS.paymentStripe.role}
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.paymentPaydunya.name}</strong> —{" "}
              {SUBPROCESSORS.paymentPaydunya.role}
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Durée de conservation">
        <LegalList
          items={[
            "Données de compte et données locatives : pendant toute la durée de la relation contractuelle avec le Gestionnaire, puis archivées pendant la durée de prescription légale applicable (notamment obligations comptables), avant suppression ou anonymisation.",
            "Pièces d'identité des locataires : conservées le temps du contrat de bail associé, puis supprimées sauf obligation légale de conservation plus longue.",
            "Photos d'incidents : conservées tant que l'incident et l'historique associé sont consultables dans le Service, puis supprimées à la clôture du compte du Gestionnaire.",
            "Journaux techniques de sécurité : conservés pour une durée limitée nécessaire à la détection d'anomalies.",
          ]}
        />
        <p>
          À la clôture d'un compte Gestionnaire, les données associées sont supprimées ou anonymisées dans un
          délai raisonnable, sous réserve des obligations légales de conservation (notamment comptables).
        </p>
      </LegalSection>

      <LegalSection title="7. Sécurité des données">
        <p>
          Le Service met en œuvre des mesures techniques et organisationnelles pour protéger les données :
          chiffrement des mots de passe, connexions chiffrées (HTTPS), isolation stricte des données entre
          Gestionnaires au niveau de la base de données (row-level security), accès aux fichiers sensibles
          (pièces d'identité, photos) restreint aux utilisateurs autorisés.
        </p>
      </LegalSection>

      <LegalSection title="8. Vos droits">
        <p>
          Conformément au RGPD et à la loi Informatique et Libertés, vous disposez des droits suivants sur vos
          données personnelles : droit d'accès, de rectification, d'effacement, de limitation du traitement,
          de portabilité, et d'opposition pour motif légitime.
        </p>
        <p>
          Pour exercer ces droits, contactez directement votre Gestionnaire (agence/bailleur) s'il s'agit de
          données que vous lui avez transmises en tant que Locataire, ou {COMPANY.contactEmail} pour toute
          autre demande. Vous disposez également du droit d'introduire une réclamation auprès de l'autorité de
          contrôle compétente (en France, la CNIL — www.cnil.fr).
        </p>
      </LegalSection>

      <LegalSection title="9. Cookies et stockage local">
        <p>
          Le Service n'utilise aucun cookie publicitaire ou de traçage à des fins commerciales. Il utilise le
          stockage local de votre navigateur (localStorage) uniquement à des fins strictement fonctionnelles :
          maintien de votre session de connexion, mémorisation de votre langue d'affichage préférée, de votre
          thème (clair/sombre) et de votre devise d'affichage. Ces données restent sur votre appareil et ne
          sont pas transmises à des tiers.
        </p>
      </LegalSection>

      <LegalSection title="10. Modification de la politique de confidentialité">
        <p>
          Cette politique peut être mise à jour pour refléter des évolutions du Service ou de la réglementation.
          La date de dernière mise à jour figure en haut de cette page.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
