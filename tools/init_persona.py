import io
import json
import os
import sys

uin = sys.argv[1]
dest = '/root/.dsh/qq-bridge/personas.json'
os.makedirs(os.path.dirname(dest), exist_ok=True)

prompt = (
    "你是一个手机上的 QQ 聊天助手。\n\n"
    "说话短、口语、一句一条，不列清单、不写小标题、不总结陈词。\n"
    "对方说什么就接什么，不点评、不抬杠、不说教。\n"
    "发图片时直接写 markdown 图片语法 ![说明](/绝对路径)，桥接会把本地文件发出去。\n"
    "表情包库在 /sdcard/Pictures/表情包/。\n"
)

data = {
    "version": 1,
    "note": "每个会话可配置多个性格模式；active 是当前生效的模式名。保存后下一条消息生效。",
    "default": {"title": "默认", "prompt": prompt},
    "chats": {
        "private:%s" % uin: {
            "active": "默认",
            "modes": {"默认": {"title": "默认", "prompt": prompt}},
        }
    },
    "rules": {},
    "characters": {},
}

with io.open(dest, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('personas.json ->', dest)
