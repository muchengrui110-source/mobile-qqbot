import io
import sys

path = sys.argv[1] if len(sys.argv) > 1 else '/root/qbot/m2o/src/gateway.py'
with io.open(path, encoding='utf-8') as f:
    text = f.read()

marker = 'app = FastAPI('
if marker not in text:
    print('未找到 FastAPI 定义，跳过')
    raise SystemExit(0)

start = text.index(marker)
end = text.index('\n)\n', start)
block = text[start:end]
if 'host=' not in block:
    print('已经打过补丁')
    raise SystemExit(0)

text = text[:start] + 'app = FastAPI(\n    lifespan=lifespan,\n    title="Milky2OneBot"' + text[end:]
with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('gateway.py 已打补丁')
