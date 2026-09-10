import json

with open('coverage/coverage-final.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for k, v in data.items():
    if 'task-detail-panel.tsx' in k:
        zero_lines = set()
        for sk, sv in v.get('statementMap', {}).items():
            if v['s'][sk] == 0:
                start_line = sv['start']['line']
                end_line = sv['end']['line']
                for l in range(start_line, end_line + 1):
                    zero_lines.add(l)
        print('Missing statement lines:', sorted(zero_lines))
        for bk, bv in v.get('branchMap', {}).items():
            hits = v['b'][bk]
            if hits[0] == 0 or hits[1] == 0:
                line = bv['loc']['start']['line']
                print('Branch L' + str(line) + ': hits=' + str(list(hits)))
        break