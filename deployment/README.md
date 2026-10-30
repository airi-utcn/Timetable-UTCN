# Deploy automat pe VM, fără SSH din GitHub Actions

Fluxul implementat este:

```text
PR merged în main
                ↓
GitHub Actions: teste backend + frontend
                ↓
Verificare PR merged în main la commit-ul curent
                ↓
Build Docker amd64/arm64 → smoke test → tag production în GHCR
                ↓ HTTPS, inițiat de VM
Timer systemd pe VM, la aproximativ 2 minute
                ↓
Pull imagine → backup → recreate serviciu → health check
                ↓ dacă eșuează
Rollback la imaginea anterioară
```

GitHub Actions nu primește parola VM-ului, certificat VPN sau cheie SSH. VM-ul
are nevoie de acces HTTPS către `ghcr.io` și serviciile de stocare folosite de
GHCR. Nu se instalează un runner GitHub pe VM. VPN-ul/SSH rămân necesare doar
pentru configurarea inițială și intervenții administrative.

Configurația este pregătită în repository; nu este instalată sau activată pe VM
de simplul commit al acestor fișiere. Primul tag `production` apare după primul
PR eligibil. Un push direct în `main`, inclusiv instalarea acestui workflow,
rulează testele, dar nu publică o versiune de producție.

Pentru prima verificare a fluxului, poate fi folosit un PR care modifică doar
documentația. După merge, verifică în GitHub Actions că jobul de
publicare reușește, apoi rulează pe VM:

```bash
sudo docker pull ghcr.io/airi-utcn/timetable-utcn:production
```

Descărcarea confirmă accesul la imagine; deploy-ul efectiv se verifică separat
în jurnalul serviciului `utcn-timetable-deploy.service`.

## Configurare GitHub, o singură dată

1. În **Settings → Rules → Rulesets**, protejează `main`: cere PR și verificările
   `Backend tests` și `Frontend tests`. Blochează force-push și bypass-ul normal
   al regulilor. Review-ul Approve este opțional pentru publicare.
2. Permite GitHub Actions pentru repository și publicarea pachetelor GHCR în
   organizația `airi-utcn`. Workflow-ul folosește `GITHUB_TOKEN`, cu
   `packages: write` doar în jobul de publicare; nu este necesar un PAT de push.
3. După prima publicare, pachetul este
   `ghcr.io/airi-utcn/timetable-utcn`. Un pachet GHCR nou poate fi privat chiar
   dacă repository-ul este public. Pentru pull anonim pe VM, setează explicit
   vizibilitatea pachetului la **public**, dacă politica organizației permite.
   Alternativ, autentifică Docker pe VM o singură dată cu un token separat
   `read:packages`. Acesta rămâne pe VM și nu este o parolă SSH/VPN.

Gate-ul verifică PR-ul asociat exact commit-ului de merge, branch-ul țintă
`main` și repository-ul. Nu cere review **Approve**; merge-ul autorizează
publicarea. Un push direct fără PR merged nu publică. Verificarea GitHub API
eșuată nu permite publicarea. Regulile de branch controlează cine poate face merge
și modifica workflow-ul; aprobările pot rămâne opționale conform politicii echipei.

Workflow-ul construiește ambele arhitecturi, verifică imaginea pe runnerul
GitHub și promovează numai o versiune care încă este commit-ul curent din
`main`. Tag-ul `production` referă același manifest deja testat. VM-ul folosește
digestul imaginii, nu un tag care s-ar putea schimba în timpul recreării.

## Configurare VM, o singură dată

Pe VM-ul Ubuntu 24.04 existent, intră manual în directorul proiectului și adu
fișierele noi:

```bash
git pull --ff-only origin main
docker compose version
```

Este necesar Docker Compose v2 cu `up --wait --wait-timeout`. Verifică `.env`
existent fără să îl suprascrii: `ADMIN_PASSWORD` trebuie să fie o parolă unică
de minimum 12 caractere, iar `FLASK_SECRET` un secret aleator de minimum 32 de
caractere. Un secret poate fi generat local cu `openssl rand -hex 32`.
Schimbarea secretului invalidează sesiunile vechi. Nu pune aceste valori în Git
sau în fișierele workflow-ului.

Pentru HTTPS, setează `SESSION_COOKIE_SECURE=1`. Dacă inventarul CSV încărcat
din admin trebuie păstrat la update-uri, setează `KEEP_VOLUME_CSV=1`.

Instalează serviciul și timerul:

```bash
sudo bash deployment/install-auto-deploy.sh
```

Installerul detectează proiectul Compose al containerului existent
`utcn-timetable`; păstrează numele ca să refolosească volumele actuale.
Dacă instalarea folosește alt nume de container sau nu există încă un
container, inspectează configurația înainte de a continua și setează explicit
`COMPOSE_PROJECT_NAME`. Nu inventa un nume nou pentru o aplicație deja instalată.

Configurația locală a updaterului este `/etc/utcn-timetable-deploy.env`:

```text
APP_DIR="/calea/reala/a/proiectului"
COMPOSE_PROJECT_NAME="numele-proiectului-existent"
IMAGE_REPOSITORY=ghcr.io/airi-utcn/timetable-utcn
```

Installerul nu activează timerul. După ce există tag-ul `production`, sunt
configurate accesul GHCR și `.env`, execută prima verificare și activează timerul:

```bash
sudo systemctl start utcn-timetable-deploy.service
sudo systemctl status utcn-timetable-deploy.service
sudo systemctl enable --now utcn-timetable-deploy.timer
```

Dacă pachetul GHCR este privat, Docker trebuie autentificat pentru utilizatorul
care rulează serviciul, adică root. Poți face `sudo docker login ghcr.io` și
introduce interactiv utilizatorul GitHub și tokenul separat de read-only.

Nu rula în paralel vechiul timer de import, un alt updater sau un alt stack
Compose asupra acelorași containere. Refresh-ul calendarelor rămâne gestionat de
aplicație; timerul nou verifică doar versiunile aplicației.

## Profil pentru VM-ul cu 16 vCPU / 16 GB RAM

Overlay-ul `docker-compose.vm.yml` fixează un profil inițial conservator:

- limită container: 12 GB RAM și 12 CPU, cu rezervă pentru sistem;
- 4 procese Gunicorn × 4 fire;
- maximum 2 browsere Playwright concurente;
- volumele, portul și datele din Compose-ul existent rămân aceleași.

Acestea sunt valori de pornire, de ajustat după măsurători. În `.env` se pot
suprascrie `VM_GUNICORN_WORKERS`, `VM_GUNICORN_THREADS` și
`VM_PLAYWRIGHT_CONCURRENCY`. `GUNICORN_WORKERS` din configurația veche nu
suprascrie profilul VM; folosește varianta cu prefixul `VM_`.

## Ce se întâmplă la fiecare verificare

Updaterul rulează cu un lock local, validează configurația și spațiul liber,
apoi face pull înainte să atingă containerul existent. Dacă imaginea este
aceeași și containerul este healthy, nu îl repornește. Dacă registrul sau
rețeaua nu sunt disponibile, versiunea curentă rămâne pornită.

Înainte de update, verifică numele proiectului Compose, păstrează o referință
locală la imaginea curentă și face backup online SQLite plus snapshot la
inventar în volumul `data`, sub `deploy-backups/`. Păstrează ultimele șapte
snapshot-uri. Nu execută `docker compose down` și nu șterge volume.

La update, recreează numai serviciul `timetable`, din imaginea deja descărcată,
și așteaptă starea healthy. Este posibilă o scurtă întrerupere în timpul
recreării: aceasta nu este o configurație cu zero downtime. Dacă health check-ul
eșuează, revine la imaginea anterioară și amână o nouă încercare a aceleiași
versiuni cu 30 de minute. Starea updaterului este în
`/var/lib/utcn-timetable-deploy/`.

Rollback-ul automat restaurează imaginea, nu baza de date. Migrațiile de schemă
incompatibile trebuie planificate separat; backup-urile nu înlocuiesc copii
independente de VM și un proces de restaurare verificat. Păstrează suficient
spațiu pentru imaginea nouă, cea anterioară, cache și date; scriptul cere implicit
minimum 5 GB liberi în filesystem-ul Docker.

## Monitorizare, pauză și rollback manual

```bash
systemctl list-timers utcn-timetable-deploy.timer
sudo journalctl -u utcn-timetable-deploy.service -n 100
sudo cat /var/lib/utcn-timetable-deploy/current-image
```

Un workflow GitHub verde confirmă testarea/publicarea imaginii, nu confirmă că
VM-ul a aplicat-o. Starea reală a deploy-ului este în jurnalul serviciului.

Pentru oprirea update-urilor:

```bash
sudo systemctl stop utcn-timetable-deploy.timer
```

Oprește și așteaptă verificarea activă înainte de un rollback manual. Folosește
același proiect, aceleași fișiere Compose și o versiune `sha-<commit>` cunoscută,
cu `TIMETABLE_IMAGE` setat explicit. Lasă timerul oprit până când tag-ul
`production` indică versiunea dorită; altfel următoarea verificare va reveni la
tag-ul de producție.

Fișierele Compose, unitățile systemd și scriptul instalat nu se actualizează
singure din interiorul imaginii. Când se schimbă mecanismul de deploy, actualizează
checkout-ul de pe VM și rulează din nou installerul, cu timerul oprit.

Documentație de referință:
[publicare Docker din Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images),
[GHCR și vizibilitatea pachetelor](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry),
[protecția branch-urilor](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[Compose up și health checks](https://docs.docker.com/reference/cli/docker/compose/up/).
