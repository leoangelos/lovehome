-- ==========================================
-- Migration 019: Templates de contrato + bucket de contratos
--
-- Os templates entram como dado inicial (não como seed de demonstração): são
-- conteúdo que a imobiliária edita e mantém, e `npm run seed` não pode
-- sobrescrever a redação revisada pelo jurídico. Por isso o INSERT é
-- condicionado a não existir template ativo do tipo.
--
-- O bucket de contratos é PRIVADO, ao contrário do de fotos: contrato carrega
-- CPF, endereço e valores. Download sai por URL assinada de vida curta.
-- ==========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contratos', 'contratos', FALSE, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Sem policy nenhuma: nem anon nem authenticated leem. Só o service_role, que
-- ignora RLS, e apenas para gerar a URL assinada no servidor.

INSERT INTO contract_templates (deal_type, name, body_template, is_active)
SELECT 'locacao', 'Locação residencial — padrão', $template$CONTRATO DE LOCAÇÃO RESIDENCIAL

LOCADOR: {{owner_name}}, CPF {{owner_cpf}}.

LOCATÁRIO: {{tenant_name}}, CPF {{tenant_cpf}}, e-mail {{tenant_email}},
residente em {{tenant_address}}.

IMÓVEL: {{property_type}} situado em {{property_address}}, {{property_region}},
{{property_city}}, com {{property_area}} de área, {{property_bedrooms}} dormitório(s),
registrado nesta imobiliária sob o código {{property_code}}.

As partes acima qualificadas têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — DO OBJETO
O LOCADOR dá em locação ao LOCATÁRIO o imóvel acima descrito, destinado
exclusivamente a fins residenciais.

CLÁUSULA 2ª — DO PRAZO
A locação vigorará por prazo determinado, com início em {{start_date}} e término em
{{end_date}}, independentemente de aviso ou notificação.

CLÁUSULA 3ª — DO ALUGUEL
O aluguel mensal é de {{rent_price}}, a ser pago até o dia 10 de cada mês.
O valor do condomínio, quando houver, é de responsabilidade do LOCATÁRIO e
corresponde atualmente a {{condo_fee}}.

CLÁUSULA 4ª — DO REAJUSTE
O aluguel será reajustado anualmente pela variação do IGP-M/FGV ou, na sua falta,
por índice que legalmente o substitua.

CLÁUSULA 5ª — DA RESCISÃO
Qualquer das partes poderá rescindir o presente contrato mediante comunicação
escrita com antecedência mínima de {{notice_period_days}} dias.
A rescisão antecipada pelo LOCATÁRIO sem observância do aviso prévio sujeita-o ao
pagamento de multa proporcional, na forma da Lei 8.245/91.

CLÁUSULA 6ª — DA CONSERVAÇÃO
O LOCATÁRIO receberá o imóvel em perfeito estado e obriga-se a devolvê-lo nas
mesmas condições, ressalvado o desgaste natural pelo uso regular.

CLÁUSULA 7ª — DO FORO
Fica eleito o foro da comarca de {{property_city}} para dirimir quaisquer questões
oriundas deste contrato.

E por estarem justos e contratados, assinam o presente instrumento.

{{property_city}}, {{today}}.


_______________________________________
LOCADOR — {{owner_name}}


_______________________________________
LOCATÁRIO — {{tenant_name}}
$template$, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM contract_templates WHERE deal_type = 'locacao' AND is_active = TRUE
);

INSERT INTO contract_templates (deal_type, name, body_template, is_active)
SELECT 'venda', 'Compra e venda — instrumento particular', $template$INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA

VENDEDOR: {{owner_name}}, CPF {{owner_cpf}}.

COMPRADOR: {{tenant_name}}, CPF {{tenant_cpf}}, e-mail {{tenant_email}},
residente em {{tenant_address}}.

IMÓVEL: {{property_type}} situado em {{property_address}}, {{property_region}},
{{property_city}}, com {{property_area}} de área, {{property_bedrooms}} dormitório(s),
registrado nesta imobiliária sob o código {{property_code}}.

As partes acima qualificadas têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — DO OBJETO
O VENDEDOR promete vender ao COMPRADOR o imóvel acima descrito, livre e
desembaraçado de quaisquer ônus.

CLÁUSULA 2ª — DO PREÇO
O preço certo e ajustado é de {{sale_price}}, a ser pago na forma da cláusula 3ª.

CLÁUSULA 3ª — DA FORMA DE PAGAMENTO
Modalidade: {{financing_type}}.
Sinal e princípio de pagamento: {{down_payment}}, pago neste ato.
O saldo remanescente será quitado conforme condições acordadas entre as partes e
formalizadas na escritura definitiva.

CLÁUSULA 4ª — DO ITBI E DEMAIS DESPESAS
O Imposto de Transmissão de Bens Imóveis (ITBI), as custas de escritura e o registro
correm por conta do COMPRADOR. Situação atual do ITBI: {{itbi_status}}.

CLÁUSULA 5ª — DA POSSE
A posse do imóvel será transmitida ao COMPRADOR na data da quitação integral do
preço, salvo acordo diverso formalizado por escrito.

CLÁUSULA 6ª — DA ESCRITURA DEFINITIVA
Quitado o preço, o VENDEDOR obriga-se a outorgar a escritura definitiva de compra e
venda no prazo de 30 dias contados da solicitação do COMPRADOR.

CLÁUSULA 7ª — DO FORO
Fica eleito o foro da comarca de {{property_city}} para dirimir quaisquer questões
oriundas deste contrato.

E por estarem justos e contratados, assinam o presente instrumento.

{{property_city}}, {{today}}.


_______________________________________
VENDEDOR — {{owner_name}}


_______________________________________
COMPRADOR — {{tenant_name}}
$template$, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM contract_templates WHERE deal_type = 'venda' AND is_active = TRUE
);
