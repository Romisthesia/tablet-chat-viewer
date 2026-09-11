#!/bin/bash
# 隐私检查：工作区 + 每个 git 引用的历史 + 悬空对象
#
# 为什么不能只看 HEAD：
#   1) git commit --amend / rebase 只挪分支指针，旧提交仍留在 .git 里；
#      只要旧提交还在某个引用的祖先链上，push 就会把它一并传上去。
#   2) 远端跟踪分支（refs/remotes/origin/main）是本地缓存，force-push 之后
#      它可能还指着旧历史，旧内容因此继续躺在 .git 里。
#   所以逐个引用检查，才能指出"是哪个引用在保着旧内容"。
#
# 用法：
#   PATTERNS="你的名字|你的ID|你的机器名" bash dev/check_privacy.sh
# 不传 PATTERNS 时只查通用泄露特征：本机绝对路径、常见邮箱域。

set -u
cd "$(dirname "$0")/.." || exit 1

SELF='check_privacy\.sh'
GEN='[A-Za-z]:[\\/]Users[\\/][^\\/" ]+|/home/[a-z_][a-z0-9_-]*/|/Users/[a-z][a-z0-9_-]*/|@(gmail|qq|163|126|outlook|hotmail|foxmail)\.[a-z]+'
if [ -n "${PATTERNS:-}" ]; then PAT="$PATTERNS|$GEN"; else PAT="$GEN"; fi

fails=0
echo "扫描模式：$PAT"
echo

echo "---- 1. 工作区（排除 .git / node_modules） ----"
hit=0
while IFS= read -r f; do
  out=$(grep -InE "$PAT" "$f" 2>/dev/null | head -3)
  if [ -n "$out" ]; then echo "  ✗ $f"; echo "$out" | sed 's/^/        /'; hit=1; fails=$((fails+1)); fi
done < <(find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | grep -vE "$SELF")
[ "$hit" = 0 ] && echo "  ✓ 干净"

echo
echo "---- 2. 逐个引用的历史 ----"
for ref in $(git for-each-ref --format='%(refname)'); do
  commits=$(git rev-list "$ref" 2>/dev/null)
  [ -z "$commits" ] && continue
  n=$(echo "$commits" | wc -l)
  h=$(git grep -InE "$PAT" $commits -- 2>/dev/null | grep -vE "$SELF" | head -3)
  if [ -n "$h" ]; then
    echo "  ✗ $ref（$n 个提交）里发现隐私内容："
    echo "$h" | sed 's/^/        /'
    fails=$((fails+1))
  else
    echo "  ✓ $ref（$n 个提交）干净"
  fi
done

echo
echo "---- 3. 悬空对象（amend/rebase 丢弃但仍在 .git 里的旧内容） ----"
u=$(git fsck --unreachable --no-progress 2>/dev/null | head -5)
if [ -n "$u" ]; then echo "$u" | sed 's/^/  ✗ /'; echo "  建议：git reflog expire --expire=now --all && git gc --prune=now"; fails=$((fails+1)); else echo "  ✓ 无"; fi

echo
if [ "$fails" = 0 ]; then
  echo "结果：PASS（未发现隐私内容）"
else
  echo "结果：FAIL（$fails 处，见上）"
fi
exit $((fails > 0 ? 1 : 0))
