# Wijzigingen

## 0.1.6

- Statuspagina: blok "Leden van de groep" met telefoonnummer en een vakje per lid om de
  voornaam in te stellen. Niemand in de groep merkt er iets van.
- De statuspagina ververst niet meer automatisch zolang de bot verbonden is.

## 0.1.5

- Aankondiging op maandag, 9 dagen vooraf (was dinsdag).
- Eén regel per stem in de groep; zodra er 4 ✅ zijn meteen de bevestiging.
- Dinsdag (8 dagen vooraf) alleen een bericht als het team niet volledig is; daarna geen herinneringen meer.
- Nieuw: herhaling van wie speelt op de dag vóór de wedstrijd.
- Alles over de reservatie van het terrein verwijderd (ook !gereserveerd).
- Testcommando's: !test dinsdag en !test herhaling (vervangen !test woensdag en !test donderdag).

## 0.1.4

- Nieuw overzicht "Stand": wie speelt, reserves, wie niet kan, wie nog niet geantwoord heeft en
  het terrein. Bij !gast, !status en in de berichten van woensdag en donderdag als er spelers ontbreken.
- De bot onthoudt nu ook de ❌-stemmen.

## 0.1.3

- Testmodus (instelling "Test mode"): met !test aankondigen, !test woensdag, !test donderdag,
  !test afsluiten en !test wissen voer je de planning meteen uit om te testen.

## 0.1.2

- Diagnose: elk binnenkomend bericht, elk commando en elk antwoord komt kort in de log
  (zonder de inhoud van berichten).
- Nieuwe instelling "Detailed log" voor technische details van de WhatsApp-koppeling.

## 0.1.1

- Herlaadherinnering afgestemd op DIGI prepaid: het nummer blijft 9 maanden geldig
  (instelbaar via "Geldigheid van de eSIM").

## 0.1.0

- Eerste versie: aankondiging op dinsdag met peiling, bevestiging op woensdag, herinnering op
  donderdag, reservelijst, gastspelers, commando's, historiek, meldingen en eSIM-herinnering.
