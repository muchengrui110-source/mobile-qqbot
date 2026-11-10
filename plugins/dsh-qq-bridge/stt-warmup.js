// 触发 DSH SenseVoice 模型下载（首次约 239MB），并验证语音识别服务可用。
// 用法：以 DSH 应用内插件方式运行，或独立跑一次准备流程。
import { mkdir } from 'node:fs/promises';

export const name = 'dsh-stt-warmup';
export const inject = ['speechToText'];

export function apply(ctx, config) {
  const log = ctx.logger('stt-warmup');
  const providerId = config?.providerId ?? 'sensevoice-local';

  ctx.effect(() => {
    (async () => {
      try {
        const providers = ctx.speechToText.listProviders();
        log.info('可用语音提供方：%s', JSON.stringify(providers.map((p) => ({ id: p.id, languages: p.languages }))));
        const snapshot = ctx.speechToText.snapshot();
        log.info('语音服务快照：%s', JSON.stringify(snapshot));
        const target = snapshot.providers.find((p) => p.id === providerId);
        if (!target) {
          log.warn('未找到提供方 %s', providerId);
          return;
        }
        log.info('准备状态：%s', JSON.stringify(target.preparation));
        if (target.preparation?.phase !== 'ready') {
          log.info('开始下载/准备模型（首次约 239MB，请耐心等待）…');
          ctx.speechToText.prepare(providerId, {});
        }
      } catch (error) {
        log.warn('warmup 失败：%s', error?.message ?? error);
      }
    })();
  }, 'stt-warmup');
}
