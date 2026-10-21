import type { Sentence, SyntaxRole, Token } from '../models/types';
import { LANGUAGES } from '../constants/languages';

type Piece = [string, SyntaxRole, string, string?];
const P = 'Predicate', S = 'Subject', A = 'Attribute_Subject', O = 'Object', C = 'Circumstance', R = 'Article';
interface ExampleSpec { subject: Piece[]; attribute: Piece; verb: Piece; object: Piece[]; place: Piece; order: 'svo' | 'sov' | 'german' | 'latin'; predicateHint: string; objectHint: string }
const specs: Record<string, ExampleSpec> = {
  en: { subject: [['The',R,'определённый артикль'],['boy',S,'мальчик']], attribute: ['little',A,'маленький'], verb: ['reads',P,'читает','read'], object: [['a',R,'неопределённый артикль'],['book',O,'книгу']], place: ['here',C,'здесь'], order:'svo', predicateHint:'Reads — форма read для третьего лица единственного числа в настоящем времени; окончание -s согласуется с boy.', objectHint:'Book стоит после reads и обозначает то, что читают. Артикль a относится к существительному book.' },
  it: { subject: [['Il',R,'определённый артикль'],['bambino',S,'мальчик']], attribute: ['piccolo',A,'маленький'], verb: ['legge',P,'читает','leggere'], object: [['un',R,'неопределённый артикль'],['libro',O,'книгу']], place: ['qui',C,'здесь'], order:'svo', predicateHint:'Legge — личная форма leggere: он читает. Ищем всё слово, а не предполагаем, что его конец всегда можно отделить как правильное окончание.', objectHint:'Libro означает предмет чтения и стоит после legge; un — его артикль. Падежного окончания, аналогичного русскому «книгу», здесь нет.' },
  es: { subject: [['El',R,'определённый артикль'],['niño',S,'мальчик']], attribute: ['pequeño',A,'маленький'], verb: ['lee',P,'читает','leer'], object: [['un',R,'неопределённый артикль'],['libro',O,'книгу']], place: ['aquí',C,'здесь'], order:'svo', predicateHint:'Lee — форма leer для третьего лица единственного числа настоящего времени. Здесь она сообщает, что делает niño.', objectHint:'Libro — то, что читают; оно следует за lee. Un относится к libro и не является частью сказуемого.' },
  de: { subject: [['Der',R,'определённый артикль'],['Junge',S,'мальчик']], attribute: ['kleine',A,'маленький','klein'], verb: ['liest',P,'читает','lesen'], object: [['ein',R,'неопределённый артикль'],['Buch',O,'книгу']], place: ['hier',C,'здесь'], order:'german', predicateHint:'Liest — личная форма lesen. В этом утверждении перед ней одна группа: Der (kleine) Junge. Второе место означает вторую группу, не обязательно второе слово.', objectHint:'Buch — то, что читают. Ein Buch здесь дополнение; у среднего рода форма артикля ein одинакова в именительном и винительном падежах, поэтому одного артикля недостаточно.' },
  fr: { subject: [['Le',R,'определённый артикль'],['garçon',S,'мальчик']], attribute: ['petit',A,'маленький'], verb: ['lit',P,'читает','lire'], object: [['un',R,'неопределённый артикль'],['livre',O,'книгу']], place: ['ici',C,'здесь'], order:'svo', predicateHint:'Lit — личная форма lire. В этом предложении действие связано с garçon; форма неправильная, её не следует разбирать по образцу обычных глаголов на -er.', objectHint:'Livre обозначает предмет чтения и следует за lit. Un — артикль существительного, а не показатель действующего лица.' },
  kz: { subject: [['Бала',S,'мальчик','бала']], attribute: ['Кішкентай',A,'маленький','кішкентай'], verb: ['оқиды',P,'читает','оқу'], object: [['кітап',O,'книгу']], place: ['мұнда',C,'здесь'], order:'sov', predicateHint:'Оқиды — личная форма оқу; в этом нейтральном предложении сказуемое завершает высказывание. Одного последнего места недостаточно: проверяем значение и форму.', objectHint:'Кітап — неопределённый предмет чтения без окончания винительного падежа. Здесь он стоит непосредственно перед оқиды; отсутствие окончания не делает его подлежащим.' },
  la: { subject: [['Puer',S,'мальчик','puer']], attribute: ['parvus',A,'маленький'], verb: ['legit',P,'читает','legere'], object: [['librum',O,'книгу','liber']], place: ['hic',C,'здесь'], order:'latin', predicateHint:'Legit здесь читается как настоящее время «он читает»; в письме без знака долготы форма может быть неоднозначна по времени. В этом учебном примере задано настоящее.', objectHint:'Librum — винительный падеж единственного числа liber. Окончание -um помогает узнать дополнение, даже когда оно находится перед глаголом.' },
};
export function developmentExamples(code: string): Sentence[] {
  const spec = specs[code];
  if (!spec) return [];
  const language = LANGUAGES.find(l => l.code === code)!.label;
  return [0,1,2,3].map(step => {
    let subject = [...spec.subject];
    if (step > 0) {
      const before = ['en','de','fr','kz'].includes(code);
      subject.splice(before ? Math.max(0, subject.length-1) : subject.length, 0, spec.attribute);
      if (code === 'kz') subject = subject.map(p => p[0] === 'Бала' ? ['бала',p[1],p[2],p[3]] : p);
    }
    const object = step >= 2 ? spec.object : [];
    const place = step >= 3 ? [spec.place] : [];
    const pieces = spec.order === 'sov' || spec.order === 'latin' ? [...subject,...place,...object,spec.verb] :
      spec.order === 'german' ? [...subject,spec.verb,...place,...object] : [...subject,spec.verb,...object,...place];
    const words: Token[] = pieces.map(([text,role,translation,lemma]) => ({ text, role, translation, dictionary_form: lemma ?? text.toLowerCase(), label: role, parts: [text], is_in_my_dict: false, clauseIndex: 0 }));
    const text = words.map(w => w.text).join(' ') + '.';
    const explanations: Partial<Record<SyntaxRole,string>> = {
      Predicate: spec.predicateHint, Object: spec.objectHint,
      Subject: 'Это участник, о котором здесь сообщается действие чтения. Сопоставьте его со сказуемым; само первое место в предложении не является универсальным правилом.',
      Attribute_Subject: 'Это слово уточняет признак мальчика. Свяжите его с существительным, а не со способом чтения.',
      Circumstance: 'Это указание места: отвечает на вопрос «где читает?». Уточняет ситуацию чтения, а не называет предмет чтения.',
    };
    return { id:`study_${code}_${step}`, language, sentence:text, words, source:'seed',
      literalTranslation: `${step > 0 ? 'Маленький мальчик' : 'Мальчик'} читает${step >= 2 ? ' книгу' : ''}${step >= 3 ? ' здесь' : ''}.`,
      markerHints: Object.entries(explanations).flatMap(([role,explanation]) => {
        const indices = words.flatMap((w,i) => w.role === role ? [i] : []);
        return indices.length ? [{ role: role as SyntaxRole, clauseIndex:0, explanation: explanation!, evidence:indices.map(i=>({tokenIndex:i,form:words[i].text})), source:'authored' as const }] : [];
      }),
    };
  });
}
export const comparisonExamples = () => LANGUAGES.map(l => developmentExamples(l.code)[3]);
