# Deploy backups

Before a deploy replaces the live build, the deploy flow writes one backup
of the instance below `/mnt/Data/PagesBackups` (PAGE-255). Writing it lies
outside this repository; `rotate-deploy-backups.sh` makes sure that only the
newest deploy backup stays. The continuous PostgreSQL backup under
`/mnt/Data/PagesPostgres` (`deploy/postgres/base-backup.sh`,
`PAGES_POSTGRES_BACKUP_KEEP`) is a mechanism of its own and is never touched.

## What the deploy flow does

1. Write the backup into a new directory directly below the backup root whose
   name contains `deploy-`, such as `deploy-20261108-1700-1f291a8` or
   `pages-main-deploy-20261108-1540`.
2. Write the checksum list of every file in it as the last step:
   `(cd <backup> && find . -type f ! -name SHA256SUMS -printf '%P\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)`.
   A list named `sha256.txt` is accepted as well.
3. Call `deploy/backups/rotate-deploy-backups.sh <backup>` with the variables
   of `deploy-backup.env.example`. Write nothing below `~/.pages`: a
   `deploy-*` folder there is a leftover and goes in this step.

## What the command checks before it removes anything

- The checksum list names every file of the backup, and every checksum
  matches (`sha256sum --check --strict`). A missing list, a file the list does
  not name, or a mismatch means the backup is incomplete.
- Every `*.dump` is a readable PostgreSQL archive (`pg_restore --list`) and
  every `*.tar` is a readable tar archive.

Only when everything passed it removes every other deploy backup in the root
(a directory whose name contains `deploy-`) and the `deploy-*` folders directly
in `PAGES_HOME`. Other directories of the root, such as a manual
`workspace-reset-*` backup, stay. A refused backup removes nothing, so the
previous backup remains the newest checked one.

| Exit | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| 0    | Checked, older deploy backups removed                       |
| 1    | Check failed or the root is unusable; nothing was removed   |
| 2    | Wrong call: no argument or a name that is no deploy backup  |

The root must not overlap `PAGES_POSTGRES_BACKUP_ROOT`; with
`PAGES_DEPLOY_BACKUP_UUID` set it must also lie on that file system, so a
missing disk never lets the command work on the system disk. A lock in the
root keeps two runs apart.
