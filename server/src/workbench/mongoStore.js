/**
 * MongoDB implementation of the WorkbenchService store interface
 * (see shared/workbench/service.js). Maps documents to plain records with
 * string ids and ISO dates so the service and the API stay storage-agnostic.
 */
import mongoose from 'mongoose';
import { Endpoint, Project, YamlFile } from './models.js';

const CASE_INSENSITIVE = { locale: 'en', strength: 2 };
const isId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const toDate = (v) => (v ? new Date(v) : undefined);

function projectDto(doc) {
  if (!doc) return null;
  return { id: String(doc._id), name: doc.name, slug: doc.slug, description: doc.description ?? '', createdAt: iso(doc.createdAt), updatedAt: iso(doc.updatedAt) };
}

function yamlDto(doc) {
  if (!doc) return null;
  const { _id, project, createdAt, updatedAt, ...rest } = doc;
  return { id: String(_id), projectId: String(project), ...rest, createdAt: iso(createdAt), updatedAt: iso(updatedAt) };
}

function endpointDto(doc) {
  const { _id, project, yamlFile, createdAt, ...rest } = doc;
  return { id: String(_id), projectId: String(project), yamlFileId: String(yamlFile), ...rest, createdAt: iso(createdAt) };
}

function datesIn(data) {
  const out = { ...data };
  if ('createdAt' in out) out.createdAt = toDate(out.createdAt);
  if ('updatedAt' in out) out.updatedAt = toDate(out.updatedAt);
  return out;
}

export function createMongoStore() {
  return {
    projects: {
      async list() {
        return (await Project.find().lean()).map(projectDto);
      },
      async get(id) {
        return isId(id) ? projectDto(await Project.findById(id).lean()) : null;
      },
      async findByName(name) {
        return projectDto(await Project.findOne({ name }).collation(CASE_INSENSITIVE).lean());
      },
      async create(data) {
        const doc = await Project.create(datesIn(data));
        return projectDto(doc.toObject());
      },
      async update(id, patch) {
        if (!isId(id)) return null;
        return projectDto(await Project.findByIdAndUpdate(id, datesIn(patch), { new: true, runValidators: true }).lean());
      },
      async remove(id) {
        if (isId(id)) await Project.deleteOne({ _id: id });
      },
    },

    yamlFiles: {
      async listByProject(projectId) {
        if (!isId(projectId)) return [];
        return (await YamlFile.find({ project: projectId }).select('-content').lean()).map(yamlDto);
      },
      async get(id) {
        return isId(id) ? yamlDto(await YamlFile.findById(id).lean()) : null;
      },
      async findByName(projectId, fileName) {
        if (!isId(projectId)) return null;
        return yamlDto(await YamlFile.findOne({ project: projectId, fileName: String(fileName) }).select('-content').lean());
      },
      async create(data) {
        const { projectId, ...rest } = data;
        const doc = await YamlFile.create({ ...datesIn(rest), project: projectId });
        return yamlDto(doc.toObject());
      },
      async update(id, patch) {
        const { projectId: _ignored, ...rest } = patch;
        return yamlDto(await YamlFile.findByIdAndUpdate(id, datesIn(rest), { new: true, runValidators: true }).select('-content').lean());
      },
      async remove(id) {
        if (isId(id)) await YamlFile.deleteOne({ _id: id });
      },
      async removeByProject(projectId) {
        if (isId(projectId)) await YamlFile.deleteMany({ project: projectId });
      },
      async countByProject() {
        const rows = await YamlFile.aggregate([{ $group: { _id: '$project', files: { $sum: 1 }, endpoints: { $sum: '$endpointCount' } } }]);
        return Object.fromEntries(rows.map((r) => [String(r._id), { files: r.files, endpoints: r.endpoints }]));
      },
    },

    endpoints: {
      async listByYamlFile(yamlFileId) {
        if (!isId(yamlFileId)) return [];
        return (await Endpoint.find({ yamlFile: yamlFileId }).sort({ _id: 1 }).lean()).map(endpointDto);
      },
      async replaceForYamlFile(yamlFileId, projectId, endpoints) {
        await Endpoint.deleteMany({ yamlFile: yamlFileId });
        if (!endpoints.length) return;
        const createdAt = new Date();
        await Endpoint.insertMany(endpoints.map((e) => ({ ...e, project: projectId, yamlFile: yamlFileId, createdAt })), { ordered: false });
      },
      async removeByYamlFile(yamlFileId) {
        if (isId(yamlFileId)) await Endpoint.deleteMany({ yamlFile: yamlFileId });
      },
      async removeByProject(projectId) {
        if (isId(projectId)) await Endpoint.deleteMany({ project: projectId });
      },
    },
  };
}
