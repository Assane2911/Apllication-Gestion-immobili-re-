import LegalLayout, { LegalList, LegalSection } from "../../components/LegalLayout";
import { COMPANY } from "../../legal/companyInfo";

export default function CGUPage() {
  return (
    <LegalLayout title="Conditions Générales d'Utilisation et de Vente">
      <LegalSection title="1. Objet">
        <p>
          Les présentes Conditions Générales d'Utilisation et de Vente (« CGU/CGV ») régissent l'accès et
          l'utilisation du service {COMPANY.tradeName} (le « Service »), plateforme de gestion locative en
          ligne permettant à un gestionnaire immobilier ou bailleur (le « Gestionnaire ») de gérer ses biens,
          locataires, contrats de bail, paiements de loyer et incidents, et à ses locataires (les
          « Locataires ») d'accéder à un portail dédié.
        </p>
        <p>
          L'utilisation du Service implique l'acceptation pleine et entière des présentes CGU/CGV. Elles sont
          éditées par {COMPANY.fullName} ({COMPANY.legalStatus}) — voir les{" "}
          <a href="/mentions-legales" className="text-brand-400 hover:text-brand-300 underline">
            mentions légales
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Création de compte et accès">
        <p>
          L'accès au Service en tant que Gestionnaire nécessite la création d'un compte, avec un email et un
          mot de passe valides. Le Gestionnaire est responsable de la confidentialité de ses identifiants et
          de toute activité effectuée depuis son compte.
        </p>
        <p>
          Les comptes Locataire sont créés par le Gestionnaire pour permettre à ses locataires d'accéder à un
          portail restreint (visualisation du bail, paiement du loyer, signalement d'incidents, messagerie).
        </p>
      </LegalSection>

      <LegalSection title="3. Formules d'abonnement et essai gratuit">
        <p>
          Le Service est proposé sous forme d'abonnement, avec les formules suivantes (susceptibles
          d'évoluer, les tarifs en vigueur étant ceux affichés sur la page tarifs du Service au moment de la
          souscription) :
        </p>
        <LegalList
          items={[
            <>
              <strong className="text-slate-100">Starter</strong> — jusqu'à 5 biens gérés.
            </>,
            <>
              <strong className="text-slate-100">Pro Agence</strong> — jusqu'à 25 biens gérés, signature
              électronique, suivi de rentabilité, marque blanche, messagerie.
            </>,
            <>
              <strong className="text-slate-100">Entreprise</strong> — biens illimités, support prioritaire,
              multi-utilisateurs, export comptable.
            </>,
          ]}
        />
        <p>
          Chaque nouvelle inscription bénéficie d'une période d'essai gratuite de 15 jours, sans engagement et
          sans carte bancaire requise, donnant accès à l'ensemble des fonctionnalités de la formule Pro. À
          l'issue de cette période, l'accès au Service est suspendu jusqu'à la souscription d'une formule
          payante.
        </p>
      </LegalSection>

      <LegalSection title="4. Paiement et facturation">
        <p>
          Les abonnements sont facturés mensuellement ou annuellement, selon le choix du Gestionnaire, via
          l'un des moyens de paiement proposés dans le Service (carte bancaire par Stripe, mobile money et
          carte bancaire par PayDunya, ou virement bancaire). Le renouvellement de l'abonnement n'est pas
          automatique pour les paiements par virement bancaire ; il est reconduit automatiquement à
          l'échéance pour les paiements par carte lorsque ce mode de reconduction est explicitement proposé
          dans l'interface.
        </p>
        <p>
          Les paiements de loyer effectués par les Locataires via le Service (carte bancaire, mobile money ou
          virement déclaré) sont traités directement par les prestataires de paiement Stripe et PayDunya ;
          le Service n'a à aucun moment accès aux données bancaires des utilisateurs.
        </p>
      </LegalSection>

      <LegalSection title="5. Obligations des utilisateurs">
        <p>Le Gestionnaire s'engage à :</p>
        <LegalList
          items={[
            "fournir des informations exactes et à jour concernant ses biens, locataires et contrats ;",
            "n'utiliser le Service qu'à des fins licites de gestion locative ;",
            <>
              respecter la réglementation applicable à la protection des données personnelles de ses
              Locataires ; à cet égard, le Gestionnaire agit en qualité de responsable du traitement pour les
              données de ses propres locataires, {COMPANY.tradeName} agissant en qualité de sous-traitant au
              sens du RGPD (voir la{" "}
              <a href="/confidentialite" className="text-brand-400 hover:text-brand-300 underline">
                Politique de confidentialité
              </a>
              ) ;
            </>,
            "ne pas tenter de contourner les mesures de sécurité du Service ni d'en perturber le fonctionnement.",
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Disponibilité et évolution du Service">
        <p>
          L'éditeur s'efforce d'assurer un accès continu au Service, sans toutefois garantir une disponibilité
          absolue (maintenance, mises à jour, incidents techniques indépendants de sa volonté). Le Service et
          ses fonctionnalités peuvent évoluer à tout moment ; les utilisateurs seront informés des changements
          substantiels.
        </p>
      </LegalSection>

      <LegalSection title="7. Résiliation">
        <p>
          Le Gestionnaire peut résilier son abonnement à tout moment depuis son espace de gestion. La
          résiliation prend effet à la fin de la période de facturation en cours ; aucun remboursement au
          prorata n'est effectué sauf disposition légale contraire.
        </p>
        <p>
          L'éditeur se réserve le droit de suspendre ou résilier l'accès au Service en cas de manquement grave
          aux présentes CGU/CGV, notamment en cas d'usage frauduleux ou de non-paiement.
        </p>
      </LegalSection>

      <LegalSection title="8. Limitation de responsabilité">
        <p>
          Le Service est un outil de gestion mis à disposition des Gestionnaires ; il ne se substitue pas à un
          conseil juridique, comptable ou fiscal. L'éditeur ne pourra être tenu responsable des décisions
          prises par les utilisateurs sur la base des informations générées par le Service (quittances,
          rapports financiers), ni des litiges entre Gestionnaires et Locataires.
        </p>
      </LegalSection>

      <LegalSection title="9. Droit applicable et litiges">
        <p>
          Les présentes CGU/CGV sont soumises au droit {COMPANY.country === "France" ? "français" : COMPANY.country}
          . À défaut de résolution amiable, tout litige relatif à leur interprétation ou leur exécution sera
          porté devant les juridictions compétentes.
        </p>
      </LegalSection>

      <LegalSection title="10. Modification des CGU/CGV">
        <p>
          L'éditeur se réserve le droit de modifier les présentes CGU/CGV à tout moment. Les utilisateurs
          seront informés de toute modification substantielle ; la poursuite de l'utilisation du Service après
          notification vaut acceptation des CGU/CGV modifiées.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
