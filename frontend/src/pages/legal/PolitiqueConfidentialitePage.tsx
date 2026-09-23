import LegalLayout, { LegalList, LegalSection } from "../../components/LegalLayout";
import { COMPANY, SUBPROCESSORS } from "../../legal/companyInfo";

export default function PolitiqueConfidentialitePage() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <LegalSection title="1. Responsable du traitement">
        <p>
          Le responsable du traitement des données personnelles collectées via {COMPANY.tradeName} est{" "}
          {COMPANY.fullName} ({COMPANY.legalStatus}), joignable à {COMPANY.contactEmail}. Son adresse postale
          est {COMPANY.address}.
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
              <strong className="text-slate-100">Coordonnées bancaires de virement</strong> : IBAN et BIC
              saisis par le Gestionnaire — ceux de son agence, affichés au Locataire qui règle par virement,
              et ceux des propriétaires auxquels il reverse les loyers. Aucune coordonnée bancaire de
              Locataire n'est enregistrée.
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
          {COMPANY.tradeName} n'a jamais accès aux données de carte bancaire ni aux identifiants de compte
          mobile money : ces données transitent exclusivement par nos prestataires de paiement (voir section
          5) et ne sont jamais enregistrées par le Service. Seuls les IBAN et BIC de virement mentionnés
          ci-dessus, saisis volontairement par le Gestionnaire, sont conservés.
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
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.email.name}</strong> —{" "}
              {SUBPROCESSORS.email.role}
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.whatsapp.name}</strong> —{" "}
              {SUBPROCESSORS.whatsapp.role}
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.googleSignIn.name}</strong> —{" "}
              {SUBPROCESSORS.googleSignIn.role}
            </>,
            <>
              <strong className="text-slate-100">{SUBPROCESSORS.errorMonitoring.name}</strong> —{" "}
              {SUBPROCESSORS.errorMonitoring.role}
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Durée de conservation">
        <p>
          Les données saisies dans le Service sont conservées tant que le compte du Gestionnaire qui les
          détient reste ouvert : le Service n'applique pas de purge automatique à l'expiration d'un délai. La
          conservation est donc commandée par deux événements — la suppression d'un élément par le
          Gestionnaire, et la clôture de son compte.
        </p>
        <LegalList
          items={[
            "Données de compte et données locatives (biens, locataires, baux, paiements, dépenses) : conservées pendant toute la durée de la relation contractuelle avec le Gestionnaire, et jusqu'à ce qu'il les supprime ou qu'il clôture son compte.",
            "Pièces d'identité des locataires et photographies (biens, annonces, incidents, baux scannés) : le fichier est supprimé du stockage en même temps que la fiche qui le référence — suppression du locataire, du bien, de l'annonce ou du contrat — et, en tout état de cause, à la clôture du compte du Gestionnaire.",
            "Messages de la messagerie intégrée : conservés tant que le compte du Gestionnaire reste ouvert.",
            "Journal d'activité de l'agence (traçabilité des actions) : conservé pendant toute la durée de vie du compte, puis supprimé avec lui.",
            "Données d'abonnement et de facturation : conservées pendant la durée requise par les obligations comptables et fiscales applicables, y compris après la clôture du compte.",
          ]}
        />
        <p>
          La clôture d'un compte Gestionnaire, que le Gestionnaire peut déclencher lui-même depuis son espace
          de gestion, entraîne la suppression définitive des données associées (biens, locataires, contrats,
          paiements, messages, journal d'activité) et des fichiers correspondants, sous réserve des données
          qu'une obligation légale impose de conserver. Il incombe au Gestionnaire, responsable du traitement
          pour les données de ses propres Locataires, de définir et d'appliquer ses propres durées de
          conservation en supprimant les éléments devenus inutiles.
        </p>
      </LegalSection>

      <LegalSection title="7. Sécurité des données">
        <p>
          Le Service met en œuvre les mesures techniques et organisationnelles suivantes : mots de passe
          stockés sous forme hachée et jamais en clair, connexions chiffrées (HTTPS), authentification par
          jeton, et vérification du rattachement à l'agence à chaque requête — un Gestionnaire n'accède qu'aux
          biens, locataires, contrats et documents de sa propre agence, cette isolation étant contrôlée par le
          code applicatif à chaque lecture comme à chaque écriture.
        </p>
        <p>
          Les documents sensibles (pièces d'identité des locataires, baux scannés, photographies d'incidents)
          sont déposés dans un espace de stockage privé : ils ne sont accessibles que par une URL signée
          temporaire, valable une heure, délivrée à un utilisateur autorisé. Les photographies des biens et
          des annonces publiées, destinées à être affichées publiquement, sont en revanche stockées dans un
          espace public : leur URL est accessible sans authentification à qui la détient, il ne faut donc y
          déposer aucune image comportant des informations personnelles.
        </p>
      </LegalSection>

      <LegalSection title="8. Vos droits">
        <p>
          Conformément au RGPD et à la loi Informatique et Libertés, vous disposez des droits suivants sur vos
          données personnelles : droit d'accès, de rectification, d'effacement, de limitation du traitement,
          de portabilité, et d'opposition pour motif légitime.
        </p>
        <p>
          Ces droits s'exercent de la manière suivante. En tant que <strong className="text-slate-100">Locataire</strong>,
          adressez-vous d'abord à votre Gestionnaire (agence ou bailleur) : c'est lui qui est responsable des
          données qu'il a saisies à votre sujet, lui seul peut les rectifier ou les supprimer depuis son
          espace de gestion, et {COMPANY.tradeName} n'y intervient que sur son instruction. Le portail
          Locataire vous permet de consulter votre bail, vos quittances et vos paiements, mais ne comporte
          aujourd'hui ni export global de vos données ni suppression de votre fiche. En tant que{" "}
          <strong className="text-slate-100">Gestionnaire</strong>, vous pouvez rectifier vos données à tout
          moment depuis votre espace, et supprimer définitivement votre compte et l'ensemble des données
          associées depuis les paramètres du Service.
        </p>
        <p>
          Pour toute autre demande — notamment l'accès à l'ensemble de vos données ou leur portabilité dans un
          format lisible par machine, qui ne sont pas encore automatisés dans le Service et sont traités
          manuellement — écrivez à {COMPANY.contactEmail} ; une réponse vous sera apportée dans le délai d'un
          mois prévu par le RGPD. Vous disposez également du droit d'introduire une réclamation auprès de
          l'autorité de contrôle compétente (en France, la CNIL — www.cnil.fr).
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
