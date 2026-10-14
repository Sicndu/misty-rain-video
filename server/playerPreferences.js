export const DEFAULT_PLAYER_PREFERENCES = {
  skipIntroOutro: false, autoNext: true, introSeconds: 90, outroSeconds: 90
};
export const normalizePlayerPreferences = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const result = { ...DEFAULT_PLAYER_PREFERENCES };
  for (const key of ['skipIntroOutro', 'autoNext']) {
    if (input?.[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw invalid();
      result[key] = input[key];
    }
  }
  for (const key of ['introSeconds', 'outroSeconds']) {
    if (input?.[key] !== undefined) {
      const value = input[key];
      if (!Number.isInteger(value) || value < 0 || value > 600) throw invalid();
      result[key] = value;
    }
  }
  return result;
};
const invalid = () => Object.assign(new Error('片头与片尾时长必须是0～600之间的整数秒数'), {
  code: 'INVALID_PLAYER_PREFERENCES', statusCode: 400
});
