# Padelbot

De Padelbot organiseert de padelwedstrijden van jullie WhatsApp-groep. We spelen op de
**1e en 3e woensdag** van elke maand, met **4 spelers** per wedstrijd.

## Wat de bot doet

| Wanneer | Bericht in de groep |
|---|---|
| Maandag, 9 dagen vooraf, 18:00 | Aankondiging, overzicht van wie hoeveel keer meespeelde (vorige 6 wedstrijden) en een peiling ✅ Ja / ❌ Nee |
| Bij elke stem | Eén regel, bv. "✅ Jan kan spelen (3/4)" of "❌ An kan niet" |
| Zodra er 4 ✅ zijn | "✅ Piet kan spelen (4/4) – het team voor … staat vast: …" |
| Dinsdag, 8 dagen vooraf, 18:00 | Alleen als het team nog niet volledig is: wie ontbreekt, met de stand. Daarna geen herinneringen meer |
| De dag vóór de wedstrijd, 18:00 | Herhaling: "🎾 Morgen padel! Op … spelen: …" |

- De **eerste 4** die ✅ stemmen, spelen. Wie later ✅ stemt, staat op de **reservelijst**.
- Zet iemand van het team zijn stem op ❌, dan schuift de eerste reserve automatisch door.
- **Gastspelers** vullen lege plaatsen aan. Een groepslid heeft altijd voorrang op een gast.
- Na de speeldag wordt de wedstrijd automatisch in de historiek gezet.

## Commando's in de groep

| Commando | Wat het doet |
|---|---|
| `!gast Marc` | Gastspeler toevoegen |
| `!gast weg Marc` | Gastspeler verwijderen |
| `!geen` | De wedstrijd gaat niet door |
| `!status` | Stand: wie speelt, reserves, wie niet kan, wie nog niet antwoordde |
| `!naam Jan` | Je naam in de berichten instellen |
| `!historiek` | Alle vorige wedstrijden |
| `!help` | Lijst met commando's |

## Eerste keer instellen

1. Zorg dat het **botnummer** (de eSIM) een WhatsApp-account heeft en lid is van de groep.
2. Vul bij **Configuratie** de **naam van de WhatsApp-groep** in, exact zoals in WhatsApp.
   Begin met je testgroep.
3. Start de App en open **Open webinterface** (of "Padelbot" in de zijbalk).
4. Koppel de bot:
   - Open WhatsApp op je telefoon en wissel naar het **bot-account**.
   - Ga naar **Instellingen → Gekoppelde apparaten → Apparaat koppelen**.
   - Scan de QR-code op de statuspagina.
   - Bekijk je Home Assistant op dezelfde telefoon? Vul dan bij Configuratie het
     **telefoonnummer van de bot** in en herstart de App. Je krijgt dan een code die je in
     WhatsApp invult via **Koppelen met telefoonnummer**.
5. De statuspagina toont "verbonden" en de naam van de groep. Klaar.

## Testen

Zet bij **Configuration** de optie **Test mode** aan en herstart de App. In de testgroep werken
dan extra commando's om de planning meteen uit te voeren:

| Commando | Wat het doet |
|---|---|
| `!test aankondigen` | Aankondiging en peiling nu, voor de volgende vrije speeldag |
| `!test dinsdag` | Het bericht van dinsdag nu (alleen als het team niet volledig is) |
| `!test herhaling` | De herhaling van de dag vóór de wedstrijd nu |
| `!test afsluiten` | De wedstrijd nu afsluiten (komt in de historiek) |
| `!test wissen` | Alle wedstrijden en de historiek wissen; de ledenlijst blijft |

Na het testen: stuur `!test wissen`, zet **Test mode** weer uit en herstart de App.

## Stand aanpassen

Meldde iemand zich af buiten de peiling? Open de statuspagina (**Padelbot** in de zijbalk) en
zet die persoon onder **Stand aanpassen** op **❌ Kan niet**. Klik **Stand opslaan**. De eerste
reserve schuift door. Er komt geen bericht in de groep; de herhaling van de dag ervoor en de
historiek gebruiken de aangepaste stand.

## Namen van de leden

Open de statuspagina (**Padelbot** in de zijbalk). Onder **Leden van de groep** staat elk lid
met zijn telefoonnummer en een vakje. Vul de voornaam in en klik op **Opslaan**. Laat je een
vakje leeg, dan gebruikt Paddy de WhatsApp-profielnaam van die persoon zodra die iets stuurt of
stemt. Leden kunnen hun eigen naam ook aanpassen met `!naam`.

## Meldingen voor de beheerder

De bot waarschuwt je als de WhatsApp-koppeling verbroken is, en wanneer de eSIM herladen moet
worden. Standaard verschijnt dat als melding in Home Assistant. Gebruik je de Home Assistant-app
op je telefoon, vul dan bij **Meldingen voor de beheerder** bv. `notify.mobile_app_jouw_telefoon`
in voor een pushmelding.

## eSIM herladen

Vul bij **Laatste herlading eSIM** de datum van activatie of van je laatste herlading in
(bv. `2026-11-22`). Een DIGI prepaid-nummer blijft 9 maanden actief na activatie of herlading
(instelling **Geldigheid van de eSIM**). De bot herinnert je 30, 14 en 3 dagen voor het nummer
vervalt. Herlaad dan met €5 via MyDIGI, pas de datum aan en herstart de App.

## Gegevens

Alles staat in de App zelf (`/data`) en zit in je gewone Home Assistant-back-ups.
