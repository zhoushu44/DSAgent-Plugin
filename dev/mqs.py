import re, sys
P = r'E:\360MoveData\Users\Administrator\Desktop\觅千手\source\pageHooks.js'
s = open(P, encoding='utf-8', errors='ignore').read()


def extract(fname):
    idx = s.find('function ' + fname)
    if idx < 0:
        return None
    depth = 0
    end = idx
    started = False
    for i in range(idx, len(s)):
        if s[i] == '{':
            depth += 1
            started = True
        elif s[i] == '}':
            depth -= 1
            if started and depth == 0:
                end = i + 1
                break
    return s[idx:end]


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'fn':
        for name in sys.argv[2:]:
            b = extract(name)
            print('=' * 76)
            print('function', name, 'len', len(b) if b else 'NOT FOUND')
            print('=' * 76)
            print(b or '')
            print()
    else:
        for kw in sys.argv[2:]:
            idxs = [m.start() for m in re.finditer(re.escape(kw), s)]
            print('=' * 76)
            print('KW', kw, 'count', len(idxs))
            for i in idxs[:3]:
                print('----- @', i, '-----')
                print(s[max(0, i - 500): i + 700])
                print()
