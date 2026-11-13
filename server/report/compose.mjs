import { generateNarrative, fallbackNarrative } from "./narrative.mjs";
import {createTextClient} from '../textClient.mjs';

export async function composeReport(bundle, { statistical = false, signal, onFailure, onProgress = () => {}, onModel = () => {} } = {}) {
  const generate = async (snapshot, label) => statistical
    ? fallbackNarrative(snapshot)
    : generateNarrative(snapshot, signal, onFailure, 0, text => onProgress(`${label}：${text}`), null, null,
      createTextClient({onModel:event=>onModel({...event,scope:label})}));
  const [overall, generatedQuestion] = await Promise.all([
    generate(bundle.overall, "整体报告"),
    bundle.question ? generate(bundle.question, "问题专题") : null,
  ]);
  const question = generatedQuestion?.omitQuestionSection ? null : generatedQuestion;
  return {
    snapshot: { ...bundle.overall, questionSection: question ? bundle.question : null },
    narrative: { ...overall, models:[...new Set([...(overall.models||[]),...(generatedQuestion?.models||[])])], ...(question ? { questionSection: question, failureCode: overall.failureCode || question.failureCode, failureModel:overall.failureCode?overall.model:question.model } : {}) },
  };
}
